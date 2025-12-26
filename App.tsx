import React, { useState, useEffect, useRef } from "react";

declare var chrome: any;

// --- Types ---

interface WordEntry {
  rank: string;
  word: string;
  definitions: { pos: string; trans: string }[];
  rawTrans: string;
}

interface ProcessedWord {
  text: string;
  translation: string;
  phoneticUs: string;
  phoneticUk: string;
  partOfSpeech: string;
  inflections: string[]; 
  tags: string[];        
  cocaRank: number;      
  image: string;
  video: {
    cover: string;
    title: string;
    url: string;
  };
}

interface FileResult {
  fileName: string;
  data: ProcessedWord[];
}

// --- Utils & Helpers ---

const getDeep = (obj: any, path: string, defaultValue: any = "") => {
  if (!obj) return defaultValue;
  const keys = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return defaultValue;
    current = current[key];
  }
  return current === undefined ? defaultValue : current;
};

const parseMarkdownFile = (content: string): WordEntry[] => {
  const entries: WordEntry[] = [];
  const blocks = content.split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    const titleMatch = lines[0].match(/^(\d+)\s+(.+)$/);
    if (!titleMatch) continue;

    const rank = titleMatch[1];
    const word = titleMatch[2];

    const defLine = lines.find((l) => l.includes('["') && (l.includes("n.") || l.includes("adj.") || l.includes("v.") || l.includes("adv.") || l.includes("prep.") || l.includes("conj.")));
    
    const definitions: { pos: string; trans: string }[] = [];
    
    if (defLine) {
      const posRegex = /([a-z]+\.)\s*(\[[^\]]+\])/g;
      let match;
      while ((match = posRegex.exec(defLine)) !== null) {
        definitions.push({
          pos: match[1].replace(".", ""),
          trans: match[2],
        });
      }
      if (definitions.length === 0 && defLine.startsWith("[")) {
          definitions.push({ pos: "misc", trans: defLine });
      }
    }

    entries.push({ rank, word, definitions, rawTrans: defLine || "" });
  }
  return entries;
};

const fetchWordData = async (word: string): Promise<any> => {
  try {
    const res = await fetch(`https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`);
    if (!res.ok) throw new Error("Network response was not ok");
    return await res.json();
  } catch (error) {
    console.error(`Failed to fetch ${word}`, error);
    return null;
  }
};

const formatTranslation = (raw: string): string => {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.join('；'); 
    }
    return String(parsed);
  } catch (e) {
    return raw.replace(/^\[|\]$/g, '').replace(/"/g, '').trim();
  }
};

// --- Components ---

const Icons = {
  Upload: () => (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{color: '#6366f1'}}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  ),
  File: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>
  ),
  Download: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  ),
  Merge: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
    </svg>
  ),
  External: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
      <polyline points="15 3 21 3 21 9"/>
      <line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
  )
};

// --- Main Component ---

const App = () => {
  const [isPopup, setIsPopup] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentWord: "" });
  const [results, setResults] = useState<FileResult[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [splitCount, setSplitCount] = useState<number>(50);
  const [dragActive, setDragActive] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.innerWidth > 600) {
      setIsPopup(false);
    }
  }, []);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const openFullPage = () => {
    if (typeof chrome !== "undefined" && chrome.tabs) {
      const url = chrome.runtime.getURL("popup.html");
      chrome.tabs.create({ url });
    } else {
      window.open(window.location.href, "_blank");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    let selectedFiles: File[] = [];
    
    if ('files' in e.target && e.target.files) {
        selectedFiles = Array.from(e.target.files);
    } else if ('dataTransfer' in e && e.dataTransfer.files) {
        selectedFiles = Array.from(e.dataTransfer.files);
    }

    if (selectedFiles.length > 0) {
      setFiles(selectedFiles);
      setResults([]);
      setLogs([]);
      setProgress({ current: 0, total: 0, currentWord: "" });
      setDragActive(false);
    }
  };

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, msg].slice(-200));
  };

  const processFiles = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setResults([]);
    
    const allResults: FileResult[] = [];
    let totalWords = 0;
    
    addLog("开始解析文件...");

    const parsedFiles = await Promise.all(files.map(async (file) => {
      const text = await file.text();
      const words = parseMarkdownFile(text);
      totalWords += words.length;
      return { fileName: file.name, words };
    }));

    setProgress({ current: 0, total: totalWords, currentWord: "初始化..." });

    const CONCURRENCY = 5;
    let globalProcessedCount = 0;

    for (const fileObj of parsedFiles) {
      const fileProcessedWords: ProcessedWord[] = [];
      const words = fileObj.words;
      addLog(`正在处理文件: ${fileObj.fileName} (共 ${words.length} 个单词)`);

      for (let i = 0; i < words.length; i += CONCURRENCY) {
        const chunk = words.slice(i, i + CONCURRENCY);
        
        await Promise.all(chunk.map(async (entry) => {
           setProgress((p) => ({ ...p, currentWord: entry.word }));
           
           const apiData = await fetchWordData(entry.word);
           
           const definitionLoop = entry.definitions.length > 0 ? entry.definitions : [{ pos: "unknown", trans: entry.rawTrans }];

           definitionLoop.forEach(def => {
             const processed: ProcessedWord = {
               text: entry.word,
               translation: formatTranslation(def.trans),
               partOfSpeech: def.pos,
               cocaRank: Number(entry.rank), 
               phoneticUs: getDeep(apiData, "ec.word[0].usphone"),
               phoneticUk: getDeep(apiData, "ec.word[0].ukphone"),
               inflections: getDeep(apiData, "collins_primary.words.indexforms", []) || [], 
               tags: getDeep(apiData, "ec.exam_type", []) || [],
               image: getDeep(apiData, "pic_dict.pic[0].image"),
               video: {
                 cover: getDeep(apiData, "word_video.word_videos[0].video.cover"),
                 title: getDeep(apiData, "word_video.word_videos[0].video.title"),
                 url: getDeep(apiData, "word_video.word_videos[0].video.url"),
               }
             };
             fileProcessedWords.push(processed);
           });

           globalProcessedCount++;
           setProgress((p) => ({ ...p, current: globalProcessedCount }));
        }));
      }
      addLog(`文件 ${fileObj.fileName} 处理完成。`);
      allResults.push({ fileName: fileObj.fileName, data: fileProcessedWords });
    }

    setResults(allResults);
    setProcessing(false);
    addLog("所有文件处理完毕！");
  };

  const downloadJSON = (filename: string, data: any) => {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    if (typeof chrome !== "undefined" && chrome.downloads) {
        chrome.downloads.download({
            url: url,
            filename: filename.endsWith('.json') ? filename : `${filename}.json`,
            saveAs: false
        });
    } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
  };

  const handleExportOriginal = () => {
    results.forEach(res => {
      downloadJSON(res.fileName.replace(/\.[^/.]+$/, "") + "_parsed", res.data);
    });
  };

  const handleExportMerged = () => {
    const allData = results.flatMap(r => r.data);
    downloadJSON("vocabulary_merged", allData);
  };

  const handleExportByQuantity = () => {
    const allData = results.flatMap(r => r.data);
    for (let i = 0; i < allData.length; i += splitCount) {
      const chunk = allData.slice(i, i + splitCount);
      downloadJSON(`vocabulary_batch_${Math.floor(i / splitCount) + 1}`, chunk);
    }
  };

  // --- Render Popup View ---
  if (isPopup) {
    return (
      <div className="popup-container">
        <style>{`
          body { margin: 0; background: #f8fafc; font-family: 'Segoe UI', sans-serif; }
          .popup-container { padding: 24px; text-align: center; width: 300px; }
          .popup-title { font-size: 20px; color: #1e293b; margin-bottom: 8px; font-weight: 600; }
          .popup-text { color: #64748b; font-size: 14px; margin-bottom: 20px; line-height: 1.5; }
          .popup-btn { 
            background: linear-gradient(135deg, #6366f1, #4f46e5); 
            color: white; border: none; padding: 10px 20px; border-radius: 8px; 
            cursor: pointer; font-weight: 500; width: 100%; transition: opacity 0.2s;
            display: flex; align-items: center; justify-content: center; gap: 8px;
          }
          .popup-btn:hover { opacity: 0.9; }
        `}</style>
        <h3 className="popup-title">单词本生成器</h3>
        <p className="popup-text">Markdown 词汇表转 JSON 工具，支持有道词典数据自动填充。</p>
        <button className="popup-btn" onClick={openFullPage}>
          <Icons.External /> 打开完整面板
        </button>
      </div>
    );
  }

  // --- Render Dashboard View ---
  const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="dashboard-container">
       <style>{`
          body { margin: 0; background: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
          .dashboard-container { max-width: 900px; margin: 40px auto; padding: 0 20px; }
          .card { background: white; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); padding: 32px; margin-bottom: 24px; }
          
          /* Header */
          .header { text-align: center; margin-bottom: 32px; }
          .title { font-size: 28px; font-weight: 800; color: #0f172a; margin: 0 0 8px 0; background: linear-gradient(to right, #4f46e5, #06b6d4); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
          .subtitle { color: #64748b; font-size: 16px; }

          /* Upload */
          .drop-zone { 
            border: 2px dashed #cbd5e1; border-radius: 12px; padding: 48px 24px; text-align: center; 
            transition: all 0.2s ease; background: #f8fafc; cursor: pointer; position: relative;
          }
          .drop-zone:hover, .drop-zone.active { border-color: #6366f1; background: #eef2ff; }
          .drop-input { position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
          .drop-text { font-size: 16px; color: #475569; margin-top: 16px; font-weight: 500; }
          .drop-subtext { font-size: 13px; color: #94a3b8; margin-top: 8px; }

          /* File List */
          .file-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; justify-content: center; }
          .file-chip { background: #e0e7ff; color: #4338ca; padding: 4px 12px; border-radius: 20px; font-size: 13px; display: flex; align-items: center; gap: 6px; }

          /* Buttons */
          .action-btn { 
            background: #4f46e5; color: white; border: none; padding: 12px 24px; border-radius: 8px; 
            font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 4px rgba(79, 70, 229, 0.2);
          }
          .action-btn:hover { background: #4338ca; transform: translateY(-1px); }
          .action-btn:disabled { background: #94a3b8; cursor: not-allowed; transform: none; }
          .secondary-btn { 
            background: white; border: 1px solid #cbd5e1; color: #475569; padding: 8px 16px; border-radius: 8px; 
            font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 6px; justify-content: center;
          }
          .secondary-btn:hover { background: #f1f5f9; border-color: #94a3b8; color: #1e293b; }

          /* Progress & Logs */
          .progress-section { margin-top: 32px; }
          .progress-bar-bg { height: 12px; background: #e2e8f0; border-radius: 6px; overflow: hidden; margin: 12px 0; }
          .progress-bar-fill { height: 100%; background: #10b981; transition: width 0.3s ease; border-radius: 6px; }
          .progress-info { display: flex; justify-content: space-between; font-size: 14px; color: #475569; font-weight: 500; }
          
          .log-window { 
            background: #1e293b; color: #cbd5e1; padding: 16px; border-radius: 8px; 
            height: 200px; overflow-y: auto; font-family: 'Menlo', 'Monaco', monospace; font-size: 12px; margin-top: 16px; line-height: 1.6;
          }
          .log-window::-webkit-scrollbar { width: 8px; }
          .log-window::-webkit-scrollbar-thumb { background: #475569; border-radius: 4px; }
          .log-item { border-bottom: 1px solid #334155; padding-bottom: 2px; margin-bottom: 2px; }

          /* Results */
          .results-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 20px; }
          .results-title { font-size: 18px; font-weight: 700; color: #1e293b; margin: 0; }
          
          .export-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
          .export-card { border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; background: #fafafa; }
          .export-card h5 { margin: 0 0 12px 0; font-size: 14px; color: #64748b; font-weight: 600; }
          
          .input-group { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
          .num-input { padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; width: 80px; text-align: center; font-size: 14px; }

          .code-preview { background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; overflow-x: auto; font-family: 'Menlo', monospace; font-size: 12px; color: #334155; max-height: 300px; }
       `}</style>

      <div className="card">
        <div className="header">
          <h1 className="title">单词本 JSON 生成器</h1>
          <p className="subtitle">解析 Markdown 词汇表，自动调用 API 填充数据，一键导出。</p>
        </div>

        <div 
          className={`drop-zone ${dragActive ? 'active' : ''}`}
          onDragEnter={() => setDragActive(true)}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleFileUpload}
        >
          <input 
            type="file" 
            multiple 
            accept=".md,.txt"
            onChange={handleFileUpload} 
            className="drop-input"
          />
          <Icons.Upload />
          <p className="drop-text">
            {files.length > 0 ? "已选择文件" : "点击选择或拖拽 Markdown 文件到这里"}
          </p>
          <p className="drop-subtext">支持 .md 或 .txt 格式</p>
          
          {files.length > 0 && (
            <div className="file-list">
              {files.map((f, i) => (
                <div key={i} className="file-chip">
                  <Icons.File /> {f.name}
                </div>
              ))}
            </div>
          )}
        </div>

        {files.length > 0 && !processing && !results.length && (
          <div style={{ textAlign: "center", marginTop: "24px" }}>
             <button className="action-btn" onClick={processFiles}>
               开始处理 ({files.length} 个文件)
             </button>
             <button 
                style={{ background: 'transparent', color: '#64748b', border: 'none', marginLeft: '16px', cursor: 'pointer', textDecoration: 'underline' }} 
                onClick={() => setFiles([])}
             >
               清空选择
             </button>
          </div>
        )}

        {(processing || results.length > 0) && (
          <div className="progress-section">
            <div className="progress-info">
              <span>当前处理: {progress.currentWord || (processing ? "准备中..." : "完成")}</span>
              <span>{percent}% ({progress.current}/{progress.total})</span>
            </div>
            <div className="progress-bar-bg">
              <div className="progress-bar-fill" style={{ width: `${percent}%` }}></div>
            </div>
            
            <div className="log-window">
              {logs.map((log, idx) => (
                <div key={idx} className="log-item"> &gt; {log}</div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}
      </div>

      {results.length > 0 && !processing && (
        <div className="card">
          <div className="results-header">
            <h3 className="results-title">处理结果与导出</h3>
            <span style={{ color: '#10b981', fontWeight: 500, fontSize: '14px' }}>
              ✓ 成功处理 {results.length} 个文件
            </span>
          </div>
          
          <div className="export-grid">
             {/* Original Export */}
             <div className="export-card">
               <h5>保持原文件结构</h5>
               <button className="secondary-btn" style={{width: '100%'}} onClick={handleExportOriginal}>
                 <Icons.Download /> 导出独立文件
               </button>
             </div>

             {/* Merged Export */}
             <div className="export-card">
               <h5>合并所有数据</h5>
               <button className="secondary-btn" style={{width: '100%'}} onClick={handleExportMerged}>
                 <Icons.Merge /> 导出合并文件 (1个JSON)
               </button>
             </div>

             {/* Batch Export */}
             <div className="export-card">
               <h5>按数量分批导出</h5>
               <div className="input-group">
                 <input 
                   type="number" 
                   value={splitCount} 
                   onChange={(e) => setSplitCount(Number(e.target.value))} 
                   className="num-input"
                 />
                 <span style={{fontSize: '13px', color: '#64748b'}}>个单词/组</span>
               </div>
               <button className="secondary-btn" style={{width: '100%'}} onClick={handleExportByQuantity}>
                 <Icons.Download /> 批量导出
               </button>
             </div>
          </div>

          <div>
            <h5 style={{ margin: '0 0 12px 0', color: '#64748b' }}>JSON 数据预览 (首个文件前2项)</h5>
            <pre className="code-preview">
              {results[0] && JSON.stringify(results[0].data.slice(0, 2), null, 2)}
            </pre>
          </div>
          
          <div style={{textAlign: 'center', marginTop: '32px'}}>
             <button className="action-btn" style={{background: '#64748b'}} onClick={() => {
                setFiles([]);
                setResults([]);
                setLogs([]);
                setProgress({ current: 0, total: 0, currentWord: "" });
             }}>
               开始新的任务
             </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;