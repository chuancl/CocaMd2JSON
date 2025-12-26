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
  ),
  Pause: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="4" width="4" height="16"></rect>
      <rect x="14" y="4" width="4" height="16"></rect>
    </svg>
  ),
  Play: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3"></polygon>
    </svg>
  ),
  Check: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
};

// --- Main Component ---

const App = () => {
  const [isPopup, setIsPopup] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentWord: "" });
  const [results, setResults] = useState<FileResult[]>([]);
  const [logs, setLogs] = useState<{msg: string, type: 'info'|'success'|'error'}[]>([]);
  const [splitCount, setSplitCount] = useState<number>(50);
  const [dragActive, setDragActive] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  
  // Refs for loop control to avoid closure staleness
  const pausedRef = useRef(false);
  const abortRef = useRef(false);

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
      setPaused(false);
      pausedRef.current = false;
      abortRef.current = false;
    }
  };

  const addLog = (msg: string, type: 'info'|'success'|'error' = 'info') => {
    setLogs((prev) => [...prev, {msg, type}].slice(-200));
  };

  const togglePause = () => {
    const newVal = !pausedRef.current;
    pausedRef.current = newVal;
    setPaused(newVal);
    addLog(newVal ? "任务已暂停等待..." : "任务继续执行", 'info');
  };

  const resetAll = () => {
    abortRef.current = true; // Signal to stop loops
    pausedRef.current = false; // Unpause so loop can exit
    setFiles([]);
    setResults([]);
    setLogs([]);
    setProcessing(false);
    setPaused(false);
    setProgress({ current: 0, total: 0, currentWord: "" });
  };

  const processFiles = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setResults([]);
    abortRef.current = false;
    pausedRef.current = false;
    setPaused(false);
    
    const allResults: FileResult[] = [];
    let totalWords = 0;
    
    addLog("开始解析文件...", 'info');

    const parsedFiles = await Promise.all(files.map(async (file) => {
      const text = await file.text();
      const words = parseMarkdownFile(text);
      totalWords += words.length;
      return { fileName: file.name, words };
    }));

    setProgress({ current: 0, total: totalWords, currentWord: "准备开始..." });

    const CONCURRENCY = 5;
    let globalProcessedCount = 0;

    for (const fileObj of parsedFiles) {
      if (abortRef.current) break;

      const fileProcessedWords: ProcessedWord[] = [];
      const words = fileObj.words;
      addLog(`正在处理文件: ${fileObj.fileName} (共 ${words.length} 个单词)`, 'info');

      for (let i = 0; i < words.length; i += CONCURRENCY) {
        if (abortRef.current) break;

        // Pause Check Loop
        while (pausedRef.current) {
            if (abortRef.current) break;
            await new Promise(r => setTimeout(r, 200));
        }

        const chunk = words.slice(i, i + CONCURRENCY);
        
        await Promise.all(chunk.map(async (entry) => {
           if (abortRef.current) return;

           setProgress((p) => ({ ...p, currentWord: entry.word }));
           
           const apiData = await fetchWordData(entry.word);
           
           const success = !!getDeep(apiData, "ec.word[0].usphone") || !!getDeep(apiData, "translation");
           if (success) {
               addLog(`[成功] ${entry.word}`, 'success');
           } else {
               addLog(`[警告] ${entry.word} 数据可能不完整`, 'error');
           }

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
      
      allResults.push({ fileName: fileObj.fileName, data: fileProcessedWords });
      if (abortRef.current) break;
      addLog(`文件 ${fileObj.fileName} 处理结束。`, 'info');
    }

    if (!abortRef.current) {
        setResults(allResults);
        addLog("所有任务已完成！", 'success');
    }
    setProcessing(false);
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
          body { margin: 0; background: linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%); font-family: 'Segoe UI', sans-serif; }
          .popup-container { padding: 32px; text-align: center; width: 320px; }
          .popup-title { font-size: 22px; margin-bottom: 12px; font-weight: 700; color: #1e3a8a; }
          .popup-text { color: #3b82f6; font-size: 14px; margin-bottom: 24px; line-height: 1.5; font-weight: 500; }
          .popup-btn { 
            background: white;
            color: #2563eb; padding: 12px 24px; border-radius: 12px; 
            cursor: pointer; font-weight: 700; width: 100%; transition: all 0.3s;
            display: flex; align-items: center; justify-content: center; gap: 8px;
            box-shadow: 0 4px 15px rgba(37, 99, 235, 0.2); border: none;
          }
          .popup-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(37, 99, 235, 0.3); }
        `}</style>
        <h3 className="popup-title">单词本生成器</h3>
        <p className="popup-text">高效解析 Markdown 词汇表<br/>自动填充有道词典数据</p>
        <button className="popup-btn" onClick={openFullPage}>
          <Icons.External /> 打开完整控制台
        </button>
      </div>
    );
  }

  // --- Render Dashboard View ---
  const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="dashboard-wrapper">
       <style>{`
          /* Global & Layout */
          body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
          .dashboard-wrapper { 
            min-height: 100vh;
            padding: 40px 20px;
            /* Light Flowery Gradient */
            background: linear-gradient(135deg, #fdfbfb 0%, #ebedee 100%);
            background: linear-gradient(to top, #dfe9f3 0%, white 100%);
            background: linear-gradient(120deg, #e0c3fc 0%, #8ec5fc 100%);
            box-sizing: border-box;
            color: #1e293b;
          }
          .container { max-width: 900px; margin: 0 auto; }
          
          /* Glassmorphism Card (Light) */
          .glass-card { 
            background: rgba(255, 255, 255, 0.65); 
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.8);
            border-radius: 24px; 
            padding: 40px; 
            margin-bottom: 32px; 
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.1);
          }
          
          /* Typography */
          .header { text-align: center; margin-bottom: 40px; }
          .title { 
            font-size: 36px; font-weight: 800; margin: 0 0 12px 0; 
            background: linear-gradient(to right, #6366f1, #ec4899, #8b5cf6); 
            -webkit-background-clip: text; -webkit-text-fill-color: transparent; 
            letter-spacing: -0.5px; 
          }
          .subtitle { color: #64748b; font-size: 16px; font-weight: 500; }

          /* Upload Area */
          .drop-zone { 
            border: 3px dashed #cbd5e1; border-radius: 16px; padding: 48px 24px; text-align: center; 
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); background: rgba(255,255,255,0.5); cursor: pointer; position: relative;
          }
          .drop-zone:hover, .drop-zone.active { border-color: #8b5cf6; background: rgba(255,255,255,0.8); transform: scale(1.01); box-shadow: 0 10px 25px rgba(139, 92, 246, 0.15); }
          .drop-input { position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
          .drop-text { font-size: 18px; color: #334155; margin-top: 16px; font-weight: 700; }
          .drop-subtext { font-size: 14px; color: #64748b; margin-top: 8px; }

          /* File Chips */
          .file-list { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; justify-content: center; }
          .file-chip { 
            background: white; border: 1px solid #e2e8f0; 
            color: #6366f1; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 600;
            display: flex; align-items: center; gap: 6px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);
          }

          /* Buttons */
          .btn-group { display: flex; justify-content: center; gap: 16px; margin-top: 32px; }
          .btn { 
            border: none; padding: 12px 32px; border-radius: 14px; 
            font-size: 15px; font-weight: 700; cursor: pointer; transition: all 0.3s;
            display: flex; align-items: center; gap: 8px;
          }
          .btn-primary { 
            background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%); color: white; 
            box-shadow: 0 4px 15px rgba(99, 102, 241, 0.35);
          }
          .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(99, 102, 241, 0.45); filter: brightness(1.1); }
          
          .btn-ghost { background: white; color: #64748b; padding: 12px 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
          .btn-ghost:hover { color: #334155; transform: translateY(-2px); box-shadow: 0 4px 15px rgba(0,0,0,0.1); }

          .btn-pause { 
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white;
            box-shadow: 0 4px 15px rgba(245, 158, 11, 0.3);
          }
          .btn-pause:hover { transform: translateY(-2px); filter: brightness(1.1); }

          .btn-resume { 
            background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white;
            box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);
          }
          .btn-resume:hover { transform: translateY(-2px); filter: brightness(1.1); }


          /* Processing Display */
          .processing-display { text-align: center; margin-top: 40px; }
          .current-word-container { 
            height: 80px; display: flex; flex-direction: column; align-items: center; justify-content: center; 
            margin-bottom: 20px; 
          }
          .current-label { font-size: 13px; text-transform: uppercase; letter-spacing: 2px; color: #64748b; margin-bottom: 8px; font-weight: 700; }
          .current-word { 
            font-size: 48px; font-weight: 900; 
            background: linear-gradient(to right, #2563eb, #db2777); -webkit-background-clip: text; -webkit-text-fill-color: transparent;
            text-shadow: 0 10px 20px rgba(37, 99, 235, 0.15);
            animation: pulse 2s infinite;
          }
          @keyframes pulse { 0% { opacity: 0.8; transform: scale(1); } 50% { opacity: 1; transform: scale(1.05); } 100% { opacity: 0.8; transform: scale(1); } }

          /* Progress Bar */
          .progress-track { height: 10px; background: rgba(255,255,255,0.6); border-radius: 5px; overflow: hidden; margin: 0 40px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.1); }
          .progress-fill { 
            height: 100%; background: linear-gradient(90deg, #6366f1, #ec4899); 
            transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
          }
          .progress-fill::after {
            content: ''; position: absolute; top: 0; left: 0; bottom: 0; right: 0;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent);
            transform: translateX(-100%); animation: shimmer 1.5s infinite;
          }
          @keyframes shimmer { 100% { transform: translateX(100%); } }
          
          .progress-stats { display: flex; justify-content: space-between; margin: 10px 40px 0 40px; font-size: 14px; color: #475569; font-family: monospace; font-weight: 600; }

          /* Terminal Log (Light Mode) */
          .terminal-window { 
            background: #ffffff; border-radius: 16px; padding: 20px; margin-top: 30px;
            border: 1px solid #e2e8f0; box-shadow: 0 10px 30px rgba(0,0,0,0.05);
            font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 13px;
          }
          .terminal-header { display: flex; gap: 6px; margin-bottom: 12px; }
          .dot { width: 10px; height: 10px; border-radius: 50%; }
          .dot-red { background: #ef4444; } .dot-yellow { background: #f59e0b; } .dot-green { background: #10b981; }
          
          .log-content { height: 180px; overflow-y: auto; color: #334155; display: flex; flex-direction: column; gap: 6px; }
          .log-content::-webkit-scrollbar { width: 6px; }
          .log-content::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
          .log-entry { padding: 2px 0; border-bottom: 1px dashed #f1f5f9; }
          .log-entry.success { color: #059669; font-weight: 600; }
          .log-entry.error { color: #dc2626; font-weight: 600; }
          .log-entry.info { color: #64748b; }

          /* Export Grid */
          .results-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #f1f5f9; padding-bottom: 20px; margin-bottom: 24px; }
          .export-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; }
          .export-card { 
            background: white; border: 1px solid #f1f5f9; 
            padding: 24px; border-radius: 20px; transition: 0.3s;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
            display: flex; flex-direction: column; justify-content: space-between;
          }
          .export-card:hover { transform: translateY(-5px); box-shadow: 0 15px 30px rgba(0, 0, 0, 0.08); border-color: #e2e8f0; }
          .export-title { font-size: 15px; color: #334155; margin: 0 0 16px 0; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
          
          .btn-secondary { 
            background: #f8fafc; color: #475569; width: 100%; border: 1px solid #e2e8f0; padding: 12px; 
            border-radius: 12px; cursor: pointer; font-size: 14px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px; transition: 0.2s;
          }
          .btn-secondary:hover { background: #f1f5f9; color: #1e293b; border-color: #cbd5e1; }
          .input-group { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
          .num-input { background: #f8fafc; border: 1px solid #cbd5e1; color: #334155; padding: 8px; border-radius: 8px; width: 70px; text-align: center; font-weight: 600; }

          .code-preview { background: #1e293b; border: 1px solid #334155; color: #e2e8f0; padding: 24px; border-radius: 16px; overflow-x: auto; font-family: monospace; font-size: 12px; max-height: 250px; margin-top: 32px; box-shadow: inset 0 2px 10px rgba(0,0,0,0.3); }
       `}</style>

      <div className="container">
        <div className="glass-card">
          <div className="header">
            <h1 className="title">Vocabulary Generator</h1>
            <p className="subtitle">Markdown 词汇表解析 · 自动数据填充 · 极速导出</p>
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
            <div style={{transform: 'scale(1.2)', marginBottom: '16px'}}>
              <Icons.Upload />
            </div>
            <p className="drop-text">
              {files.length > 0 ? "文件已就绪" : "拖拽 Markdown 文件至此"}
            </p>
            <p className="drop-subtext">{files.length > 0 ? `共选择了 ${files.length} 个文件` : "支持多文件批量上传"}</p>
            
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
            <div className="btn-group">
               <button className="btn btn-primary" onClick={processFiles}>
                 <Icons.Check /> 开始极速处理
               </button>
               <button className="btn btn-ghost" onClick={resetAll}>
                 清空列表
               </button>
            </div>
          )}

          {(processing || results.length > 0) && (
            <div className="processing-display">
              <div className="current-word-container">
                 {processing && <span className="current-label">Running Task</span>}
                 <div className="current-word">
                   {processing ? (paused ? "PAUSED" : progress.currentWord) : "Completed"}
                 </div>
              </div>

              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${percent}%` }}></div>
              </div>
              <div className="progress-stats">
                 <span>{percent}% 完成</span>
                 <span>{progress.current} / {progress.total} 词条</span>
              </div>
              
              {processing && (
                <div style={{marginTop: '24px'}}>
                  <button 
                    className={`btn ${paused ? 'btn-resume' : 'btn-pause'}`} 
                    style={{margin: '0 auto', padding: '10px 24px'}} 
                    onClick={togglePause}
                  >
                    {paused ? <><Icons.Play /> 继续处理</> : <><Icons.Pause /> 暂停任务</>}
                  </button>
                </div>
              )}

              <div className="terminal-window">
                <div className="terminal-header">
                  <div className="dot dot-red"></div>
                  <div className="dot dot-yellow"></div>
                  <div className="dot dot-green"></div>
                </div>
                <div className="log-content">
                  {logs.map((log, idx) => (
                    <div key={idx} className={`log-entry ${log.type}`}>
                      <span style={{opacity: 0.5, marginRight: '8px', fontSize: '12px'}}>[{new Date().toLocaleTimeString().split(' ')[0]}]</span>
                      {log.msg}
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </div>
            </div>
          )}
        </div>

        {results.length > 0 && !processing && (
          <div className="glass-card">
            <div className="results-header">
              <h3 style={{margin: 0, fontSize: '20px', fontWeight: 700, color: '#1e293b'}}>处理结果</h3>
              <span style={{ color: '#059669', fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Icons.Check /> {results.length} 个文件处理完成
              </span>
            </div>
            
            <div className="export-grid">
               <div className="export-card">
                 <h5 className="export-title">独立文件导出</h5>
                 <div style={{marginTop: 'auto'}}>
                   <button className="btn-secondary" onClick={handleExportOriginal}>
                     <Icons.Download /> 下载 JSON 文件
                   </button>
                 </div>
               </div>

               <div className="export-card">
                 <h5 className="export-title">合并导出</h5>
                 <div style={{marginTop: 'auto'}}>
                   <button className="btn-secondary" onClick={handleExportMerged}>
                     <Icons.Merge /> 下载合并版 (All-in-One)
                   </button>
                 </div>
               </div>

               <div className="export-card">
                 <h5 className="export-title">分批次导出</h5>
                 <div style={{marginTop: 'auto'}}>
                   <div className="input-group">
                     <input 
                       type="number" 
                       value={splitCount} 
                       onChange={(e) => setSplitCount(Number(e.target.value))} 
                       className="num-input"
                     />
                     <span style={{fontSize: '13px', color: '#64748b'}}>个单词 / 组</span>
                   </div>
                   <button className="btn-secondary" onClick={handleExportByQuantity}>
                     <Icons.Download /> 批量下载
                   </button>
                 </div>
               </div>
            </div>

            <pre className="code-preview">
              {results[0] ? JSON.stringify(results[0].data.slice(0, 2), null, 2) : "// No data available"}
            </pre>
            
            <div style={{textAlign: 'center', marginTop: '32px'}}>
               <button className="btn btn-ghost" onClick={resetAll}>
                 开始新的任务
               </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;