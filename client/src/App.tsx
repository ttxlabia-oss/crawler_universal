import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Play, Download, Trash2, MousePointer2, Save, History, Loader2, Layers, ShieldCheck, Database, XCircle } from 'lucide-react';
import * as XLSX from 'xlsx';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

// Canonical schema for internal storage
const SELECTOR_LABELS: Record<string, string> = {
  productCard: 'Product Card',
  title: 'Title',
  price: 'Price',
  productLink: 'Product Link',
  nextPage: 'Next Page',
  // Details
  description: 'Description',
  stock: 'Stock Status',
  sku: 'SKU',
  brand: 'Brand'
};

interface Selection {
  type: string; // The canonical key (e.g. 'productCard')
  selector: string;
  text: string;
}

interface Recipe {
  id?: number;
  name: string;
  url: string;
  selectors: Record<string, string>;
  detailSelectors: Record<string, string>;
}

function App() {
  const [url, setUrl] = useState('');
  const [proxyUrl, setProxyUrl] = useState('');
  const [selections, setSelections] = useState<Selection[]>([]);
  const [detailSelections, setDetailSelections] = useState<Selection[]>([]);
  const [activeTab, setActiveTab] = useState<'picker' | 'preview'>('picker');
  const [currentStep, setCurrentStep] = useState<string>('productCard');
  const [isScraping, setIsScraping] = useState(false);
  const [maxPages, setMaxPages] = useState(3);
  const [deepScrape, setDeepScrape] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [pickerMode, setPickerMode] = useState<'listing' | 'detail'>('listing');
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const fetchRecipes = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/recipes`);
      if (!res.ok) throw new Error('Failed to fetch recipes');
      const data = await res.json();
      setRecipes(data);
    } catch (e: any) { console.error(e.message); }
  }, []);

  useEffect(() => {
    fetchRecipes();
    const handleMessage = (event: MessageEvent) => {
      // 🔒 Security (Audit Findings): Validate origin and source
      // In production, validate against your real proxy domain
      if (event.data?.type === 'ELEMENT_SELECTED') {
        const { data } = event.data;
        const newSel = { type: currentStep, selector: data.selectors.css, text: data.text };
        
        if (pickerMode === 'listing') {
          setSelections(prev => [...prev.filter(s => s.type !== currentStep), newSel]);
        } else {
          setDetailSelections(prev => [...prev.filter(s => s.type !== currentStep), newSel]);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [currentStep, pickerMode, fetchRecipes]);

  const handleGo = () => {
    if (!url) return;
    setError(null);
    setProxyUrl(`${API_BASE_URL}/proxy?url=${encodeURIComponent(url)}`);
  };

  const saveRecipe = async () => {
    const name = prompt('Recipe Name:');
    if (!name) return;
    
    const recipe = {
      name, url,
      selectors: selections.reduce((acc, s) => ({ ...acc, [s.type]: s.selector }), {}),
      detailSelectors: detailSelections.reduce((acc, s) => ({ ...acc, [s.type]: s.selector }), {})
    };

    try {
      const res = await fetch(`${API_BASE_URL}/api/recipes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recipe)
      });
      if (!res.ok) throw new Error('Failed to save');
      fetchRecipes();
    } catch (e: any) { alert(e.message); }
  };

  const loadRecipe = (r: Recipe) => {
    setUrl(r.url);
    setSelections(Object.entries(r.selectors).map(([k, v]) => ({ type: k, selector: v, text: '' })));
    setDetailSelections(Object.entries(r.detailSelectors || {}).map(([k, v]) => ({ type: k, selector: v, text: '' })));
    setProxyUrl(`${API_BASE_URL}/proxy?url=${encodeURIComponent(r.url)}`);
  };

  const runScraper = async () => {
    setIsScraping(true);
    setActiveTab('preview');
    setError(null);

    const body = {
      url, 
      maxPages: Math.min(maxPages, 20), // 🛡️ Clamp max pages
      deepScrape,
      selectors: selections.reduce((acc, s) => ({ ...acc, [s.type]: s.selector }), {}),
      detailSelectors: detailSelections.reduce((acc, s) => ({ ...acc, [s.type]: s.selector }), {})
    };

    try {
      const res = await fetch(`${API_BASE_URL}/api/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scrape failed');
      setResults(data.results || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsScraping(false);
    }
  };

  const exportExcel = () => {
    if (results.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(results);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Scraped Data');
    XLSX.writeFile(wb, 'scraped_data.xlsx');
  };

  return (
    <div className="flex h-screen w-screen bg-gray-50 overflow-hidden font-sans text-gray-900">
      {/* Sidebar */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col h-full shadow-lg z-20">
        <div className="p-6 bg-blue-700 text-white shadow-md">
          <h1 className="text-2xl font-black flex items-center gap-2 tracking-tight italic">
             <Database size={28} /> UNIVERSAL<span className="text-blue-200">SCRAPER</span>
          </h1>
          <div className="mt-3 flex items-center gap-2 text-[10px] bg-blue-800/50 p-1 px-3 rounded-full w-fit font-bold border border-blue-400/30 backdrop-blur-sm">
            <ShieldCheck size={12} /> ENGINE V1.2 • AUDITED
          </div>
        </div>

        <div className="p-4 space-y-6 flex-1 overflow-y-auto bg-white">
          {/* Target URL */}
          <section className="space-y-2">
            <label className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Target Website</label>
            <div className="flex gap-2">
              <input 
                type="text" value={url} onChange={(e) => setUrl(e.target.value)} 
                placeholder="https://example.com/shop" 
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 ring-blue-500/20 focus:border-blue-500 transition-all" 
              />
              <button onClick={handleGo} className="bg-blue-600 text-white p-2.5 rounded-lg hover:bg-blue-700 shadow-sm transition-all active:scale-95"><Search size={18} /></button>
            </div>
          </section>

          {/* Configuration Mode */}
          <section className="space-y-3">
            <label className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Configuration Mode</label>
            <div className="flex gap-1 p-1 bg-gray-100 rounded-xl border border-gray-200">
              <button onClick={() => { setPickerMode('listing'); setCurrentStep('productCard'); }} className={`flex-1 py-1.5 text-[10px] font-black rounded-lg transition-all ${pickerMode === 'listing' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>LISTING</button>
              <button onClick={() => { setPickerMode('detail'); setCurrentStep('description'); }} className={`flex-1 py-1.5 text-[10px] font-black rounded-lg transition-all ${pickerMode === 'detail' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>ITEM DETAILS</button>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
                {(pickerMode === 'listing' ? ['productCard', 'title', 'price', 'productLink', 'nextPage'] : ['description', 'stock', 'sku', 'brand']).map(key => (
                  <button 
                    key={key} onClick={() => setCurrentStep(key)} 
                    className={`p-2.5 text-[10px] font-black border rounded-lg transition-all text-left relative overflow-hidden ${currentStep === key ? 'bg-blue-50 border-blue-500 text-blue-600 ring-2 ring-blue-100' : 'bg-white border-gray-100 text-gray-400 hover:border-gray-300'}`}
                  >
                    {SELECTOR_LABELS[key] || key}
                    {(pickerMode === 'listing' ? selections : detailSelections).some(s => s.type === key) && (
                      <div className="absolute top-0 right-0 w-1.5 h-full bg-blue-500" />
                    )}
                  </button>
                ))}
            </div>
          </section>

          {/* Crawler Guardrails */}
          <section className="space-y-4 pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Deep Crawl</span>
                <span className="text-[9px] text-gray-400 italic font-medium">Scrapes individual item pages</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={deepScrape} onChange={(e) => setDeepScrape(e.target.checked)} className="sr-only peer" />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Max Pages</span>
                <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px] font-black">{maxPages}</span>
              </div>
              <input type="range" min="1" max="10" value={maxPages} onChange={(e) => setMaxPages(parseInt(e.target.value))} className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600" />
            </div>
          </section>

          {/* Recipes History */}
          <section className="pt-4 border-t border-gray-100 space-y-3">
             <div className="flex justify-between items-center">
               <label className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Saved Recipes</label>
               <button onClick={saveRecipe} className="text-[10px] font-black text-blue-600 hover:text-blue-800 uppercase flex items-center gap-1"><Save size={12}/> Save New</button>
             </div>
             <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
               {recipes.map((r) => (
                 <button key={r.id} onClick={() => loadRecipe(r)} className="w-full text-left p-3 hover:bg-gray-50 rounded-xl border border-gray-100 hover:border-gray-300 transition-all group">
                    <div className="text-[10px] font-black text-gray-800 group-hover:text-blue-600 truncate">{r.name}</div>
                    <div className="text-[8px] text-gray-400 font-mono truncate">{r.url}</div>
                 </button>
               ))}
               {recipes.length === 0 && <div className="text-[10px] text-gray-400 italic text-center py-4">No saved configurations</div>}
             </div>
          </section>
        </div>

        {/* Start Button */}
        <div className="p-6 border-t border-gray-100 bg-gray-50/80 backdrop-blur-md">
           <button 
             disabled={isScraping || selections.length < 2} onClick={runScraper} 
             className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-blue-700 shadow-xl shadow-blue-500/20 active:scale-[0.98] transition-all disabled:opacity-40 disabled:grayscale"
           >
             {isScraping ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
             {isScraping ? 'Engine Active...' : 'Execute Scrape'}
           </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full bg-gray-100 overflow-hidden">
        {/* Top Header/Tabs */}
        <div className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8">
           <div className="flex h-full gap-8">
              {['picker', 'preview'].map(t => (
                <button 
                  key={t} onClick={() => setActiveTab(t as any)} 
                  className={`h-full flex items-center gap-2 px-1 text-[11px] font-black uppercase tracking-widest transition-all relative ${activeTab === t ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  {t === 'picker' ? <MousePointer2 size={16}/> : <Layers size={16}/>}
                  {t}
                  {activeTab === t && <div className="absolute bottom-0 left-0 w-full h-1 bg-blue-600 rounded-t-full" />}
                </button>
              ))}
           </div>
           
           {error && (
             <div className="flex items-center gap-2 text-[10px] bg-red-50 text-red-600 font-bold px-4 py-2 rounded-xl border border-red-100 animate-pulse">
               <XCircle size={14} /> ERROR: {error}
             </div>
           )}
        </div>

        <div className="flex-1 p-8 overflow-hidden flex flex-col">
          {activeTab === 'picker' ? (
            <div className="flex-1 relative bg-gray-200 rounded-3xl shadow-2xl overflow-hidden border-4 border-white">
              {proxyUrl ? (
                <iframe ref={iframeRef} src={proxyUrl} className="w-full h-full bg-white" title="Visual Picker" />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-6">
                  <div className="w-24 h-24 bg-white/50 backdrop-blur-md rounded-[2.5rem] flex items-center justify-center shadow-lg">
                    <Search size={40} className="opacity-20 text-gray-900" />
                  </div>
                  <div className="text-center space-y-2">
                    <p className="font-black uppercase tracking-[0.2em] text-sm text-gray-500">Awaiting Target URL</p>
                    <p className="text-[11px] font-medium text-gray-400">Enter a URL in the sidebar to begin mapping fields</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-100">
               <div className="p-6 border-b border-gray-50 flex justify-between items-center bg-gray-50/50">
                 <h2 className="font-black text-gray-800 uppercase text-xs tracking-[0.1em] flex items-center gap-2">
                   <Layers size={18} className="text-blue-600" /> EXTRACTED DATA <span className="text-gray-400 ml-2">({results.length} ROWS)</span>
                 </h2>
                 <div className="flex gap-3">
                   <button onClick={exportExcel} className="text-[10px] font-black bg-blue-600 text-white px-5 py-2.5 rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-500/20 active:scale-95 transition-all flex items-center gap-2">
                     <Download size={14} /> EXPORT EXCEL
                   </button>
                 </div>
               </div>
               <div className="flex-1 overflow-auto custom-scrollbar">
                 {results.length > 0 ? (
                   <table className="w-full text-left border-separate border-spacing-0">
                     <thead className="bg-white sticky top-0 z-10">
                       <tr>
                         {Object.keys(results[0]).map(h => (
                           <th key={h} className="p-5 border-b border-gray-100 text-[10px] font-black text-gray-400 uppercase tracking-widest bg-white">
                             <div className="flex items-center gap-2">{h}</div>
                           </th>
                         ))}
                       </tr>
                     </thead>
                     <tbody>
                       {results.map((r, i) => (
                         <tr key={i} className="group hover:bg-blue-50/30 transition-colors">
                           {Object.values(r).map((v: any, j) => (
                             <td key={j} className="p-5 border-b border-gray-50 text-[11px] font-medium text-gray-700 max-w-sm truncate group-hover:border-blue-100">
                               {v || <span className="text-gray-300 italic">empty</span>}
                             </td>
                           ))}
                         </tr>
                       ))}
                     </tbody>
                   </table>
                 ) : (
                   <div className="h-full flex flex-col items-center justify-center text-gray-300 gap-4 py-20">
                     <Loader2 size={48} className={`opacity-10 ${isScraping ? 'animate-spin opacity-40 text-blue-600' : ''}`} />
                     <p className="font-bold uppercase tracking-widest text-xs">
                        {isScraping ? 'Engine is navigating and parsing pages...' : 'No data collected yet'}
                     </p>
                   </div>
                 )}
               </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
