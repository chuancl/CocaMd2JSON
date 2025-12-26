import React, { useState, useEffect } from "react";

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
  inflections: string;
  tags: string;
  cocaRank: string;
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

// --- Main Component ---

const App = () => {
  const [isPopup, setIsPopup] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentWord: "" });
  const [results, setResults] = useState<FileResult[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [splitCount, setSplitCount] = useState<number>(50);

  useEffect(() => {
    // Basic detection: if body width is constrained, it's likely a popup
    if (window.innerWidth > 600) {
      setIsPopup(false);
    }
  }, []);

  const openFullPage = () => {
    if (typeof chrome !== "undefined" && chrome.tabs) {
      // In WXT/Extension environment
      const url = chrome.runtime.getURL("entrypoints/popup/index.html");
      chrome.tabs.create({ url });
    } else {
      // Fallback for dev environment or if chrome API is mocked
      window.open(window.location.href, "_blank");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
      setResults([]);
      setLogs([]);
      setProgress({ current: 0, total: 0, currentWord: "" });
    }
  };

  const addLog = (msg: string) => {
    setLogs((prev) => [msg, ...prev].slice(0, 100));
  };

  const processFiles = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setResults([]);
    
    const allResults: FileResult[] = [];
    let totalWords = 0;
    
    const parsedFiles = await Promise.all(files.map(async (file) => {
      const text = await file.text();
      const words = parseMarkdownFile(text);
      totalWords += words.length;
      return { fileName: file.name, words };
    }));

    setProgress({ current: 0, total: totalWords, currentWord: "Initializing..." });

    const CONCURRENCY = 5;
    let globalProcessedCount = 0;

    for (const fileObj of parsedFiles) {
      const fileProcessedWords: ProcessedWord[] = [];
      const words = fileObj.words;

      for (let i = 0; i < words.length; i += CONCURRENCY) {
        const chunk = words.slice(i, i + CONCURRENCY);
        
        await Promise.all(chunk.map(async (entry) => {
           setProgress((p) => ({ ...p, currentWord: entry.word }));
           
           const apiData = await fetchWordData(entry.word);
           
           const definitionLoop = entry.definitions.length > 0 ? entry.definitions : [{ pos: "unknown", trans: entry.rawTrans }];

           definitionLoop.forEach(def => {
             const processed: ProcessedWord = {
               text: entry.word,
               translation: def.trans.replace(/^"|"$/g, ''),
               partOfSpeech: def.pos,
               cocaRank: entry.rank,
               phoneticUs: getDeep(apiData, "ec.word[0].usphone"),
               phoneticUk: getDeep(apiData, "ec.word[0].ukphone"),
               inflections: JSON.stringify(getDeep(apiData, "collins_primary.words.indexforms", [])),
               tags: JSON.stringify(getDeep(apiData, "ec.exam_type", [])),
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
           addLog(`Processed [${entry.word}]`);
        }));
      }
      
      allResults.push({ fileName: fileObj.fileName, data: fileProcessedWords });
    }

    setResults(allResults);
    setProcessing(false);
    addLog("All files processed successfully.");
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
        // Fallback for non-extension environment
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
      downloadJSON(`vocabulary_batch_${(i / splitCount) + 1}`, chunk);
    }
  };

  // --- Styles ---
  
  const styles: any = {
    container: {
      fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
      padding: "20px",
      backgroundColor: "#f9f9f9",
      minHeight: "100vh",
      color: "#333",
      boxSizing: "border-box",
      width: isPopup ? "350px" : "100%", // Explicit width for popup
    },
    header: {
      marginBottom: "20px",
      borderBottom: "1px solid #ddd",
      paddingBottom: "10px",
    },
    title: {
      fontSize: "24px",
      fontWeight: 600,
      color: "#2c3e50",
    },
    dropZone: {
      border: "2px dashed #3498db",
      borderRadius: "8px",
      padding: "40px",
      textAlign: "center",
      backgroundColor: "#fff",
      cursor: "pointer",
      marginBottom: "20px",
      transition: "background 0.3s",
    },
    button: {
      backgroundColor: "#3498db",
      color: "white",
      border: "none",
      padding: "10px 20px",
      borderRadius: "4px",
      cursor: "pointer",
      fontSize: "16px",
      fontWeight: 500,
      marginRight: "10px",
    },
    secondaryButton: {
      backgroundColor: "#2ecc71",
      color: "white",
      border: "none",
      padding: "8px 16px",
      borderRadius: "4px",
      cursor: "pointer",
      fontSize: "14px",
      marginTop: "10px",
      marginRight: "10px",
    },
    progressContainer: {
      marginTop: "20px",
      backgroundColor: "#fff",
      padding: "15px",
      borderRadius: "8px",
      boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
    },
    progressBar: {
      height: "20px",
      backgroundColor: "#ecf0f1",
      borderRadius: "10px",
      overflow: "hidden",
      marginTop: "10px",
    },
    progressFill: (percent: number) => ({
      height: "100%",
      width: `${percent}%`,
      backgroundColor: "#2ecc71",
      transition: "width 0.3s ease",
    }),
    logArea: {
      backgroundColor: "#2c3e50",
      color: "#ecf0f1",
      padding: "10px",
      borderRadius: "4px",
      height: "150px",
      overflowY: "auto",
      fontFamily: "monospace",
      fontSize: "12px",
      marginTop: "10px",
    },
    previewArea: {
      marginTop: "20px",
      backgroundColor: "#fff",
      padding: "15px",
      borderRadius: "8px",
      border: "1px solid #ddd",
    },
    codeBlock: {
      backgroundColor: "#f4f4f4",
      padding: "10px",
      borderRadius: "4px",
      overflowX: "auto",
      maxHeight: "300px",
      fontSize: "12px",
    },
    input: {
      padding: "8px",
      borderRadius: "4px",
      border: "1px solid #ccc",
      width: "80px",
      marginRight: "10px",
    },
    exportSection: {
      display: "flex",
      alignItems: "center",
      flexWrap: "wrap",
      gap: "10px",
      marginTop: "10px",
    }
  };

  // --- Render Popup View ---
  if (isPopup) {
    return (
      <div style={styles.container}>
        <h3 style={styles.title}>Vocabulary Processor</h3>
        <p>Use the full dashboard for file processing.</p>
        <button style={styles.button} onClick={openFullPage}>
          Open Dashboard
        </button>
      </div>
    );
  }

  // --- Render Dashboard View ---
  const percent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Vocabulary JSON Generator</h1>
        <p>Parse markdown vocabulary lists, enrich with Youdao API, and export to JSON.</p>
      </header>

      <div 
        style={styles.dropZone} 
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files) handleFileUpload({ target: { files: e.dataTransfer.files } } as any);
        }}
      >
        <p style={{ fontSize: "18px", color: "#7f8c8d" }}>
          {files.length > 0 
            ? `${files.length} files selected` 
            : "Drag & drop Markdown files here, or click to select"}
        </p>
        <input 
          type="file" 
          multiple 
          accept=".md,.txt"
          onChange={handleFileUpload} 
          style={{ display: files.length > 0 ? "none" : "inline-block", marginTop: "10px" }} 
        />
        {files.length > 0 && !processing && (
          <div style={{ marginTop: "20px" }}>
             <button style={styles.button} onClick={processFiles}>Start Processing</button>
             <button style={{...styles.button, backgroundColor: "#95a5a6"}} onClick={() => setFiles([])}>Clear</button>
          </div>
        )}
      </div>

      {(processing || results.length > 0) && (
        <div style={styles.progressContainer}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Processing: {progress.currentWord}</span>
            <span>{progress.current} / {progress.total}</span>
          </div>
          <div style={styles.progressBar}>
            <div style={styles.progressFill(percent) as React.CSSProperties}></div>
          </div>
          
          <div style={styles.logArea}>
            {logs.map((log, idx) => (
              <div key={idx}>{log}</div>
            ))}
          </div>
        </div>
      )}

      {results.length > 0 && !processing && (
        <div style={styles.previewArea}>
          <h3>Results Preview</h3>
          <p>Successfully processed {results.length} files.</p>
          
          <div style={styles.exportSection}>
             <button style={styles.secondaryButton} onClick={handleExportOriginal}>
               Export Individual Files ({results.length})
             </button>
             <button style={styles.secondaryButton} onClick={handleExportMerged}>
               Export Merged (Single JSON)
             </button>
             <div style={{ display: "flex", alignItems: "center", border: "1px solid #ddd", padding: "5px", borderRadius: "4px" }}>
               <span>Split by quantity: </span>
               <input 
                 type="number" 
                 value={splitCount} 
                 onChange={(e) => setSplitCount(Number(e.target.value))} 
                 style={{...styles.input, marginLeft: "10px"}} 
               />
               <button style={{...styles.secondaryButton, margin: 0}} onClick={handleExportByQuantity}>
                 Export Batches
               </button>
             </div>
          </div>

          <div style={{ marginTop: "20px" }}>
            <h4>JSON Sample (First 2 items of first file):</h4>
            <pre style={styles.codeBlock}>
              {results[0] && JSON.stringify(results[0].data.slice(0, 2), null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;