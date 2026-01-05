
import React, { useState, useEffect, useCallback } from 'react';
import { Lead, BusinessType } from './types';
import { fetchLeadsBatch, ApiKeyError } from './services/geminiService';
import { enrichLeadWithGrok, GrokApiKeyError } from './services/xaiService';
import Header from './components/Header';
import SearchForm from './components/SearchForm';
import ResultsDisplay from './components/ResultsDisplay';

const LOCAL_STORAGE_GEMINI_KEYS_KEY = 'ai_lead_finder_gemini_keys';
const LOCAL_STORAGE_GROK_KEYS_KEY = 'ai_lead_finder_grok_keys';
const NUM_API_KEY_SLOTS = 5;
const BATCH_SIZE = 5; // Reduced batch size for smoother enrichment flow

const App: React.FC = () => {
  // --- Search Form State ---
  const [searchMode, setSearchMode] = useState<'niche-location' | 'website-url'>('niche-location');
  const [websiteUrl, setWebsiteUrl] = useState<string>('');
  const [relatedSiteLocationPreference, setRelatedSiteLocationPreference] = useState<'site-inferred' | 'global' | 'manual'>('site-inferred');
  const [manualLocationInput, setManualLocationInput] = useState<string>('');
  const [niche, setNiche] = useState<string>('Boutique Coffee Roasters');
  const [location, setLocation] = useState<string>('Portland, Oregon');
  const [businessType, setBusinessType] = useState<BusinessType>('Any Business');
  const [includeKeywords, setIncludeKeywords] = useState<string>('');
  const [excludeKeywords, setExcludeKeywords] = useState<string>('');
  const [numberOfLeads, setNumberOfLeads] = useState<number>(10);
  const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-flash');

  // --- Leads and UI State ---
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState<boolean>(false);
  const [totalCollectedLeadsCount, setTotalCollectedLeadsCount] = useState<number>(0);
  const [currentBatchProgressMessage, setCurrentBatchProgressMessage] = useState<string>('');

  // --- API Key Management State (Gemini) ---
  const [geminiApiKeys, setGeminiApiKeys] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_GEMINI_KEYS_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      return Array.from({ length: NUM_API_KEY_SLOTS }, (_, i) => parsed[i] || '');
    } catch { return Array(NUM_API_KEY_SLOTS).fill(''); }
  });
  const [geminiKeyStatus, setGeminiKeyStatus] = useState<Map<string, 'active' | 'hit_limit' | 'failed' | 'idle'>>(new Map());

  // --- API Key Management State (Grok) ---
  const [grokApiKeys, setGrokApiKeys] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_GROK_KEYS_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      return Array.from({ length: NUM_API_KEY_SLOTS }, (_, i) => parsed[i] || '');
    } catch { return Array(NUM_API_KEY_SLOTS).fill(''); }
  });
  const [grokKeyStatus, setGrokKeyStatus] = useState<Map<string, 'active' | 'hit_limit' | 'failed' | 'idle'>>(new Map());

  const [showApiKeySettings, setShowApiKeySettings] = useState<boolean>(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'gemini' | 'grok'>('gemini');

  // --- Persistence & Status Reset ---
  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_GEMINI_KEYS_KEY, JSON.stringify(geminiApiKeys));
    setGeminiKeyStatus(prev => {
      const next = new Map();
      geminiApiKeys.forEach(k => k.trim() && next.set(k, prev.get(k) || 'idle'));
      return next;
    });
  }, [geminiApiKeys]);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_GROK_KEYS_KEY, JSON.stringify(grokApiKeys));
    setGrokKeyStatus(prev => {
      const next = new Map();
      grokApiKeys.forEach(k => k.trim() && next.set(k, prev.get(k) || 'idle'));
      return next;
    });
  }, [grokApiKeys]);

  // --- Handlers ---
  const handleUpdateKey = (type: 'gemini' | 'grok', index: number, val: string) => {
    if (type === 'gemini') {
      setGeminiApiKeys(prev => { const n = [...prev]; n[index] = val.trim(); return n; });
    } else {
      setGrokApiKeys(prev => { const n = [...prev]; n[index] = val.trim(); return n; });
    }
  };

  const handleClearAllLeads = () => {
    setLeads([]);
    setHasSearched(false);
    setError(null);
    setTotalCollectedLeadsCount(0);
  };

  const handleUpdateLead = (website: string, updates: Partial<Lead>) => {
    setLeads(prev => prev.map(l => l.website === website ? { ...l, ...updates } : l));
  };

  // --- THE CORE PIPELINE ---
  const handleSearch = async () => {
    setIsLoading(true);
    setError(null);
    setLeads([]);
    setHasSearched(true);
    setTotalCollectedLeadsCount(0);
    setCurrentBatchProgressMessage('');

    const validGeminiKeys = geminiApiKeys.filter(k => k.trim());
    const validGrokKeys = grokApiKeys.filter(k => k.trim());

    if (validGeminiKeys.length === 0) {
      setError("Please add at least one Gemini API Key to start.");
      setIsLoading(false);
      return;
    }

    // Warn if no Grok keys (Enrichment will be skipped)
    if (validGrokKeys.length === 0) {
      // We can allow proceeding but maybe show a toast? For now, we'll just skip enrichment silently or log it.
      console.warn("No Grok keys found. Enrichment will be skipped.");
    }

    let collectedLeads: Lead[] = [];
    let loopCount = 0;

    // Reset Statuses
    setGeminiKeyStatus(prev => { const n = new Map(prev); validGeminiKeys.forEach(k => n.set(k, 'idle')); return n; });
    setGrokKeyStatus(prev => { const n = new Map(prev); validGrokKeys.forEach(k => n.set(k, 'idle')); return n; });

    try {
      while (collectedLeads.length < numberOfLeads) {
        loopCount++;
        const leadsNeeded = Math.min(BATCH_SIZE, numberOfLeads - collectedLeads.length);
        if (leadsNeeded <= 0) break;

        // --- STAGE 1: Discovery (Gemini) ---
        setCurrentBatchProgressMessage(`Discovery Phase: Finding ${leadsNeeded} companies...`);
        const excludedSites = collectedLeads.map(l => l.website);

        const discoveryResult = await fetchLeadsBatch(
          searchMode,
          niche, location, websiteUrl, relatedSiteLocationPreference, manualLocationInput,
          { businessType, includeKeywords, excludeKeywords },
          selectedModel,
          validGeminiKeys,
          leadsNeeded,
          excludedSites
        );

        // Update Gemini Status
        setGeminiKeyStatus(prev => {
          const n = new Map(prev);
          n.set(discoveryResult.usedApiKey, 'active');
          return n;
        });

        let newLeads = discoveryResult.leads;

        // Add placeholders immediately to UI so user sees "Scanning..."
        const newLeadsWithPlaceholder = newLeads.filter(nl => !collectedLeads.some(cl => cl.website === nl.website));
        if (newLeadsWithPlaceholder.length === 0 && loopCount > 3) break; // Avoid infinite searching if no new leads found

        collectedLeads = [...collectedLeads, ...newLeadsWithPlaceholder];
        setLeads([...collectedLeads]); // Trigger UI update

        // --- STAGE 2: Enrichment (Grok) ---
        if (validGrokKeys.length > 0) {
          setCurrentBatchProgressMessage(`Enrichment Phase: Deep diving into ${newLeadsWithPlaceholder.length} companies...`);

          // Process enrichment in parallel
          const enrichmentPromises = newLeadsWithPlaceholder.map(async (lead) => {
            try {
              const { updates, usedApiKey } = await enrichLeadWithGrok(lead, validGrokKeys);

              // Update Grok Status
              setGrokKeyStatus(prev => {
                const n = new Map(prev);
                n.set(usedApiKey, 'active');
                return n;
              });

              // Update the specific lead in state immediately as it finishes
              handleUpdateLead(lead.website, updates);

            } catch (err: any) {
              console.error(`Enrichment failed for ${lead.name}:`, err);
              // If it was a key error, update status
              if (err instanceof GrokApiKeyError && err.attemptedKeyDetails) {
                setGrokKeyStatus(prev => {
                  const n = new Map(prev);
                  err.attemptedKeyDetails?.forEach(d => n.set(d.key, d.isRateLimit ? 'hit_limit' : 'failed'));
                  return n;
                });
              }
            }
          });

          await Promise.all(enrichmentPromises); // Wait for this batch to finish enriching before next discovery batch (optional, but cleaner flow)
        }

        setTotalCollectedLeadsCount(collectedLeads.length);
        if (collectedLeads.length < numberOfLeads) await new Promise(r => setTimeout(r, 1000));
      }

    } catch (err: any) {
      console.error("Search Loop Error:", err);
      setError(err.message || 'An unexpected error occurred.');

      // Update status if it was a Gemini Key Error
      if (err instanceof ApiKeyError && err.attemptedKeyDetails) {
        setGeminiKeyStatus(prev => {
          const n = new Map(prev);
          err.attemptedKeyDetails?.forEach(d => n.set(d.key, d.isRateLimit ? 'hit_limit' : 'failed'));
          return n;
        });
      }
    } finally {
      setIsLoading(false);
      setCurrentBatchProgressMessage('Process Complete.');
    }
  };

  const getStatusBadge = (status: string) => {
    if (status === 'active') return <span className="text-xs text-green-400 bg-green-900/30 px-2 py-0.5 rounded border border-green-500/50">Active</span>;
    if (status === 'hit_limit') return <span className="text-xs text-red-400 bg-red-900/30 px-2 py-0.5 rounded border border-red-500/50">Limit Hit</span>;
    if (status === 'idle') return <span className="text-xs text-gray-400 bg-gray-700/50 px-2 py-0.5 rounded">Idle</span>;
    return <span className="text-xs text-gray-500">Unknown</span>;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 sm:p-6 lg:p-8 font-sans">
      <div className="max-w-7xl mx-auto">
        <Header />

        <main className="mt-8 space-y-8">
          <SearchForm
            searchMode={searchMode} setSearchMode={setSearchMode}
            websiteUrl={websiteUrl} setWebsiteUrl={setWebsiteUrl}
            niche={niche} setNiche={setNiche}
            location={location} setLocation={setLocation}
            businessType={businessType} setBusinessType={setBusinessType}
            includeKeywords={includeKeywords} setIncludeKeywords={setIncludeKeywords}
            excludeKeywords={excludeKeywords} setExcludeKeywords={setExcludeKeywords}
            numberOfLeads={numberOfLeads} setNumberOfLeads={setNumberOfLeads}
            selectedModel={selectedModel} onModelChange={setSelectedModel}
            onSearch={handleSearch} isLoading={isLoading}
            relatedSiteLocationPreference={relatedSiteLocationPreference} setRelatedSiteLocationPreference={setRelatedSiteLocationPreference}
            manualLocationInput={manualLocationInput} setManualLocationInput={setManualLocationInput}
          />

          {/* API Key Settings Toggle */}
          <div className="mt-6">
            <button onClick={() => setShowApiKeySettings(!showApiKeySettings)} className="text-sm text-gray-400 hover:text-white flex items-center gap-2 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 18H7.5M3.75 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 1 0-3 0M10.5 12H21" />
              </svg>
              Manage AI Intelligence Keys
            </button>

            {showApiKeySettings && (
              <div className="mt-4 bg-gray-800 rounded-lg border border-gray-700 overflow-hidden animate-fadeIn">
                <div className="flex border-b border-gray-700">
                  <button
                    onClick={() => setActiveSettingsTab('gemini')}
                    className={`flex-1 py-3 text-sm font-medium ${activeSettingsTab === 'gemini' ? 'bg-amber-600/20 text-amber-500 border-b-2 border-amber-500' : 'text-gray-400 hover:bg-gray-700'}`}
                  >
                    Step 1: Discovery (Gemini)
                  </button>
                  <button
                    onClick={() => setActiveSettingsTab('grok')}
                    className={`flex-1 py-3 text-sm font-medium ${activeSettingsTab === 'grok' ? 'bg-amber-600/20 text-amber-500 border-b-2 border-amber-500' : 'text-gray-400 hover:bg-gray-700'}`}
                  >
                    Step 2: Enrichment (Grok)
                  </button>
                </div>

                <div className="p-4 space-y-4">
                  <p className="text-xs text-gray-400 mb-2">
                    {activeSettingsTab === 'gemini'
                      ? "Gemini is used to find broad business lists (Discovery)."
                      : "Grok is used to find specific people and contact info (Enrichment). Use xAI API Keys."}
                  </p>

                  {(activeSettingsTab === 'gemini' ? geminiApiKeys : grokApiKeys).map((k, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 w-8">#{i + 1}</span>
                      <input
                        type="password"
                        value={k}
                        onChange={(e) => handleUpdateKey(activeSettingsTab, i, e.target.value)}
                        placeholder={`Enter ${activeSettingsTab === 'gemini' ? 'Gemini' : 'Grok'} API Key`}
                        className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
                      />
                      {getStatusBadge((activeSettingsTab === 'gemini' ? geminiKeyStatus : grokKeyStatus).get(k) || 'idle')}
                    </div>
                  ))}
                  <div className="text-xs text-gray-500 pt-2 border-t border-gray-700">
                    Keys are stored locally in your browser. {activeSettingsTab === 'grok' && <a href="https://console.x.ai/" target="_blank" className="text-amber-500 hover:underline">Get Grok Keys Here</a>}
                  </div>
                </div>
              </div>
            )}
          </div>

          <ResultsDisplay
            leads={leads}
            isLoading={isLoading}
            error={error}
            hasSearched={hasSearched}
            totalCollectedLeadsCount={totalCollectedLeadsCount}
            currentBatchProgressMessage={currentBatchProgressMessage}
            onUpdateLead={handleUpdateLead}
            onClearAllLeads={handleClearAllLeads}
            searchMode={searchMode}
            targetNumberOfLeads={numberOfLeads}
          />
        </main>
      </div>
    </div>
  );
};

export default App;