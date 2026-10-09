import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, AudioLines, BookOpen, Check,
  CheckCircle2, ChevronDown, Copy, Cpu, Database, Download, FileSearch,
  Globe2, Layers3, LockKeyhole, Mail, Menu, MessageSquareText, Mic,
  MicOff, Network, PhoneOff, Play, Radio, Send, ShieldCheck, Sparkles, X
} from 'lucide-react';
import { PCMMicrophone, PCMPlayer } from './audio';

type Language = 'fr' | 'en';
type Section = 'overview' | 'technology' | 'privacy' | 'diagnostic' | 'contact';
type State = 'idle' | 'connecting' | 'live';
type Transcript = { role: 'user' | 'assistant'; text: string; id: number };
type Lead = { company: string; industry: string; team: string; challenge: string; privacy: string };

const modules = [
  { id: 'technology', number: '01', icon: FileSearch, titleFr: 'Comprendre vos données', titleEn: 'Understand your data',
    textFr: 'Recherche documentaire enrichie, preuves vérifiables et contexte métier grâce au RAG.',
    textEn: 'Context-aware document retrieval, cited evidence and business understanding through RAG.' },
  { id: 'privacy', number: '02', icon: ShieldCheck, titleFr: 'Conserver le contrôle', titleEn: 'Keep control',
    textFr: 'Une IA conçue pour fonctionner dans votre environnement, avec vos règles de confidentialité.',
    textEn: 'AI designed to run in your environment, under your own data governance.' },
  { id: 'diagnostic', number: '03', icon: Cpu, titleFr: 'Automatiser l’essentiel', titleEn: 'Automate what matters',
    textFr: 'Identifier les tâches répétitives et imaginer un assistant adapté aux réalités opérationnelles.',
    textEn: 'Identify repetitive workflows and envision AI suited to everyday operations.' },
] as const;

const prompts = [
  { fr: 'Explique-moi ASYT en 30 secondes', en: 'Describe ASYT in 30 seconds' },
  { fr: 'Comment fonctionne votre RAG ?', en: 'How does your RAG work?' },
  { fr: 'Mes données restent-elles en local ?', en: 'Does my data stay on-premise?' },
  { fr: 'Mon entreprise peut-elle utiliser ASYT ?', en: 'Could my company use ASYT?' },
];

export default function App() {
  const [lang, setLang] = useState<Language>('fr');
  const fr = lang === 'fr';
  const [mobileOpen, setMobileOpen] = useState(false);
  const [health, setHealth] = useState<'checking' | 'ready' | 'offline'>('checking');
  const [status, setStatus] = useState<State>('idle');
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [section, setSection] = useState<Section>('overview');
  const [transcript, setTranscript] = useState<Transcript[]>([]);
  const [typed, setTyped] = useState('');
  const [lead, setLead] = useState<Lead>({ company: '', industry: '', team: '1–10', challenge: '', privacy: 'local' });
  const [summaryReady, setSummaryReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const micRef = useRef<PCMMicrophone | null>(null);
  const playerRef = useRef<PCMPlayer | null>(null);
  const mutedRef = useRef(false);
  const liveRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const transcriptId = useRef(0);

  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 85000);
    fetch('/api/health', { signal: controller.signal })
      .then(r => setHealth(r.ok ? 'ready' : 'offline'))
      .catch(() => setHealth('offline'))
      .finally(() => window.clearTimeout(timer));
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, []);

  const addTranscript = (role: 'user' | 'assistant', text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setTranscript(previous => [...previous, { role, text: clean, id: ++transcriptId.current }].slice(-16));
  };

  const stopVoice = () => {
    liveRef.current = false;
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    micRef.current?.stop();
    micRef.current = null;
    void playerRef.current?.close();
    playerRef.current = null;
    const ws = socketRef.current;
    socketRef.current = null;
    if (ws && ws.readyState < WebSocket.CLOSING) ws.close(1000, 'Visitor ended session');
    setStatus('idle');
    setLevel(0);
    setSpeaking(false);
  };

  useEffect(() => () => {
    liveRef.current = false;
    micRef.current?.stop();
    void playerRef.current?.close();
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.close();
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const startVoice = async () => {
    if (status !== 'idle') return;
    if (!consent) { setError(fr ? 'Confirmez d’abord votre accord pour utiliser Gemini Cloud.' : 'Please agree to Gemini cloud processing first.'); return; }
    if (health !== 'ready') { setError(fr ? 'Le serveur vocal n’est pas disponible actuellement.' : 'Voice service is currently unavailable.'); return; }
    setError('');
    setStatus('connecting');
    try {
      const player = new PCMPlayer();
      playerRef.current = player;
      await player.unlock();
      const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(scheme + '//' + location.host + '/live');
      socketRef.current = ws;
      timerRef.current = window.setTimeout(() => {
        if (!liveRef.current && socketRef.current === ws) {
          setError(fr ? 'Connexion trop longue. Essayez à nouveau.' : 'Connection timed out. Please retry.');
          stopVoice();
        }
      }, 120000);
      ws.onmessage = async event => {
        if (socketRef.current !== ws) return;
        let message: Record<string, unknown>;
        try { message = JSON.parse(String(event.data)) as Record<string, unknown>; } catch { return; }
        if (message.type === 'ready') {
          liveRef.current = true;
          if (timerRef.current !== null) window.clearTimeout(timerRef.current);
          setStatus('live');
          const mic = new PCMMicrophone();
          micRef.current = mic;
          try {
            await mic.start(
              pcm => { if (!mutedRef.current && socketRef.current?.readyState === WebSocket.OPEN && socketRef.current.bufferedAmount < 250000) socketRef.current.send(JSON.stringify({ type: 'audio', audio: pcm })); },
              volume => setLevel(volume)
            );
          } catch {
            setError(fr ? 'Accès au microphone refusé ou impossible. Vérifiez les permissions du navigateur.' : 'Microphone permission denied or unavailable. Check browser settings.');
            stopVoice();
          }
        } else if (message.type === 'audio' && typeof message.data === 'string') {
          setSpeaking(true);
          playerRef.current?.play(message.data);
        } else if (message.type === 'turn_complete') {
          setSpeaking(false);
        } else if (message.type === 'interrupted') {
          playerRef.current?.interrupt();
          setSpeaking(false);
        } else if (message.type === 'transcript' && typeof message.text === 'string') {
          addTranscript(message.role === 'user' ? 'user' : 'assistant', message.text);
        } else if (message.type === 'navigate' && typeof message.section === 'string') {
          const valid: Section[] = ['overview', 'technology', 'privacy', 'diagnostic', 'contact'];
          if (valid.includes(message.section as Section)) {
            const next = message.section as Section;
            setSection(next);
            document.getElementById(next)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        } else if (message.type === 'error') {
          setError(typeof message.text === 'string' ? message.text : 'Gemini Live is unavailable.');
          stopVoice();
        }
      };
      ws.onerror = () => {
        setError(fr ? 'Erreur réseau avec le service vocal.' : 'Voice service network error.');
        stopVoice();
      };
      ws.onclose = () => { if (socketRef.current === ws) stopVoice(); };
    } catch {
      setError(fr ? 'Impossible de lancer la conversation.' : 'Could not start the conversation.');
      stopVoice();
    }
  };

  const sendText = (text: string) => {
    if (status !== 'live' || !text.trim() || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type: 'text', text: text.trim().slice(0, 2000) }));
    addTranscript('user', text);
    setTyped('');
  };

  const moveTo = (next: Section) => {
    setSection(next);
    setMobileOpen(false);
    document.getElementById(next)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const leadSummary = (fr ? 'Diagnostic exploratoire ASYT Experience' : 'ASYT Experience exploratory discovery') + '\n' +
    (fr ? 'Entreprise' : 'Company') + ': ' + (lead.company.trim() || '—') + '\n' +
    (fr ? 'Secteur' : 'Industry') + ': ' + (lead.industry || '—') + '\n' +
    (fr ? 'Équipe concernée' : 'Team size') + ': ' + lead.team + '\n' +
    (fr ? 'Enjeu' : 'Challenge') + ': ' + (lead.challenge.trim() || '—') + '\n' +
    (fr ? 'Contrainte des données' : 'Data requirement') + ': ' + lead.privacy + '\n\n' +
    (fr ? 'Résumé indicatif, non transmis automatiquement à ASYT.' : 'Exploratory summary, not automatically sent to ASYT.');

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(leadSummary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError(fr ? 'Impossible de copier automatiquement. Sélectionnez le résumé.' : 'Cannot copy automatically. Select the summary.');
    }
  };

  const downloadSummary = () => {
    const blob = new Blob([leadSummary], { type: 'text/plain;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href; link.download = 'ASYT-Experience-diagnostic.txt'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  return (
    <div className="site-shell" id="top">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="ASYT Experience, accueil">
          <span className="brand-mark">A<span>✦</span></span>
          <span className="brand-words"><strong>ASYT<span className="brand-dot">.</span></strong><small>EXPERIENCE</small></span>
        </a>
        <nav className={mobileOpen ? 'site-nav is-open' : 'site-nav'} aria-label={fr ? 'Navigation principale' : 'Main navigation'}>
          <button onClick={() => moveTo('overview')}>{fr ? 'Le concept' : 'Overview'}</button>
          <button onClick={() => moveTo('technology')}>{fr ? 'Notre technologie' : 'Technology'}</button>
          <button onClick={() => moveTo('privacy')}>{fr ? 'Confidentialité' : 'Privacy'}</button>
          <button onClick={() => moveTo('diagnostic')}>{fr ? 'Votre projet' : 'Your project'}</button>
        </nav>
        <div className="header-right">
          <div className="lang-switch" role="group" aria-label="Language">
            <button className={fr ? 'active' : ''} onClick={() => setLang('fr')} aria-pressed={fr}>FR</button>
            <button className={!fr ? 'active' : ''} onClick={() => setLang('en')} aria-pressed={!fr}>EN</button>
          </div>
          <button className="header-cta" onClick={() => moveTo('voice')}><AudioLines size={16}/><span>{fr ? 'Parler à ASYT' : 'Talk to ASYT'}</span></button>
          <button className="nav-toggle" aria-label={mobileOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileOpen} onClick={() => setMobileOpen(v => !v)}>{mobileOpen ? <X/> : <Menu/>}</button>
        </div>
      </header>

      <main>
        <section id="overview" className="hero" aria-labelledby="hero-title">
          <div className="hero-noise" aria-hidden="true"/>
          <div className="hero-content">
            <div className="eyebrow"><span className="eyebrow-line"/><span>ASYT / AI EXPERIENCE 001</span></div>
            <h1 id="hero-title">{fr ? 'L’intelligence,' : 'Intelligence,'}<br/><em>{fr ? 'en toute maîtrise.' : 'on your terms.'}</em></h1>
            <p className="hero-text">{fr
              ? 'Vos données. Vos règles. Votre intelligence artificielle. Découvrez une nouvelle vision de l’IA professionnelle — et échangez avec notre conseiller vocal.'
              : 'Your data. Your rules. Your AI. Explore a new vision of enterprise intelligence — and meet our voice consultant.'}</p>
            <div className="hero-actions">
              <button className="button-primary" onClick={() => moveTo('voice')}>{fr ? 'Découvrir par la voix' : 'Explore by voice'}<ArrowUpRight size={18}/></button>
              <button className="button-quiet" onClick={() => moveTo('technology')}>{fr ? 'Notre approche' : 'Our approach'}<ArrowRight size={17}/></button>
            </div>
            <div className="hero-micro"><span className="micro-dot"/> {fr ? 'UNE CONVERSATION. UNE AUTRE PERSPECTIVE.' : 'ONE CONVERSATION. A DIFFERENT PERSPECTIVE.'}</div>
          </div>
          <div className="hero-graphic" aria-hidden="true">
            <div className="graphics-grid"/>
            <div className="graphic-ring ring-a"/><div className="graphic-ring ring-b"/><div className="graphic-ring ring-c"/>
            <span className="hero-monogram">A</span>
            <span className="graphic-tiny top">AUTONOMY / 2026</span>
            <span className="graphic-tiny bottom">LOCAL FIRST — ALWAYS</span>
          </div>
        </section>

        <div className="manifesto-line"><span>01 / {fr ? 'DÉCOUVRIR ASYT' : 'DISCOVER ASYT'}</span><span>CONVERSATION-LED EXPERIENCE <ArrowDownRight size={15}/></span></div>
        <section id="voice" className="voice-section" aria-labelledby="voice-heading">
          <div className="section-heading">
            <span className="eyebrow muted">01 — THE VOICE EXPERIENCE</span>
            <h2 id="voice-heading">{fr ? 'Une voix. Des idées.' : 'One voice. New ideas.'}<br/><em>{fr ? 'Une vraie conversation.' : 'A real conversation.'}</em></h2>
            <p>{fr ? 'Interrogez ASYT, découvrez la technologie et explorez votre prochain projet. Sans formulaire interminable.' : 'Ask, challenge, discover. Get to know our technology and explore your next project through a natural conversation.'}</p>
          </div>
          <div className="voice-layout">
            <div className={'voice-stage ' + (status === 'live' ? 'is-live ' : '') + (speaking ? 'is-speaking' : '')}>
              <div className="stage-head"><span>ASYT <span className="stage-slash">/</span> LIVE INTERFACE</span><span className="status-chip"><span/> {status === 'live' ? 'ON AIR' : status === 'connecting' ? 'CONNECTING' : 'GEMINI 3.8 LIVE'}</span></div>
              <div className="orb-wrap" style={{ '--activity': String(level) } as React.CSSProperties}>
                <span className="orb-glow"/><span className="orb-ring ring-one"/><span className="orb-ring ring-two"/><span className="orb-ring ring-three"/>
                <span className="orb-star star-a">✦</span><span className="orb-star star-b">✧</span>
                <button type="button" className="orb-core" onClick={status === 'live' ? stopVoice : () => void startVoice()} disabled={status === 'connecting' || health !== 'ready' || (!consent && status !== 'live')} aria-label={status === 'live' ? (fr ? 'Arrêter la conversation' : 'End conversation') : (fr ? 'Démarrer la voix' : 'Start voice')}>
                  {speaking ? <span className="wave-mark" aria-hidden="true">{[1,2,3,4,5].map(n=><i key={n}/>)}</span> : <strong>A</strong>}
                  <small>{status === 'live' ? 'LIVE' : 'ASYT'}</small>
                </button>
              </div>
              <div className="voice-caption"><span className="pulse-led"/><span>{status === 'live' ? (speaking ? (fr ? 'ASYT vous répond…' : 'ASYT is speaking…') : (fr ? 'Je vous écoute' : 'Listening to you')) : status === 'connecting' ? (fr ? 'Connexion à Gemini…' : 'Connecting to Gemini…') : (fr ? 'Votre conseiller vocal est prêt' : 'Your voice consultant is ready')}</span></div>
              <h3>{fr ? 'La meilleure présentation ?' : 'The best introduction?'}<br/><em>{fr ? 'Une conversation.' : 'A conversation.'}</em></h3>
              <p className="stage-description">{fr ? 'Parlez naturellement, posez vos questions et interrompez librement la réponse.' : 'Speak naturally, ask follow-up questions and interrupt the response whenever you like.'}</p>
              <label className="privacy-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={status !== 'idle'} /><span>{fr ? 'J’accepte que ma voix et mes questions soient transmises à Google Gemini Cloud pour cette démonstration.' : 'I agree that this demo sends my voice and questions to Google Gemini Cloud.'}</span></label>
              <div className="voice-buttons">
                <button className="stage-primary" onClick={status === 'live' ? stopVoice : () => void startVoice()} disabled={status === 'connecting' || (status !== 'live' && (!consent || health !== 'ready'))}>
                  {status === 'live' ? <PhoneOff size={18}/> : <Mic size={18}/>}
                  {status === 'live' ? (fr ? 'Terminer l’échange' : 'End conversation') : status === 'connecting' ? (fr ? 'Connexion…' : 'Connecting…') : (fr ? 'Parler à ASYT' : 'Talk to ASYT')}
                  <ArrowUpRight size={17}/>
                </button>
                {status === 'live' && <button className="mute-button" onClick={() => setMuted(v => !v)} aria-label={muted ? (fr ? 'Réactiver le micro' : 'Unmute') : (fr ? 'Couper le micro' : 'Mute')} title={muted ? 'Unmute' : 'Mute'}>{muted ? <MicOff size={18}/> : <Mic size={18}/>}</button>}
              </div>
              {health === 'checking' && <p className="stage-note" role="status">{fr ? 'Vérification du serveur vocal…' : 'Checking voice service…'}</p>}
              {health === 'offline' && <p className="stage-note error-text" role="status">{fr ? 'La démo vocale est en attente de configuration serveur.' : 'The voice demo is waiting for server configuration.'}</p>}
              {error && <p className="stage-note error-text" role="alert">{error}</p>}
              <div className="stage-bottom"><LockKeyhole size={14}/><span>{fr ? 'Démo en ligne · Produit ASYT local distinct' : 'Online demo · Separate from on-premise ASYT software'}</span><span>001</span></div>
            </div>
            <div className="conversation-card" id="conversation">
              <div className="conversation-head"><div><span className="small-index">02 / INTERACTION</span><h3>{fr ? 'L’échange' : 'The conversation'}</h3></div><span className="transcript-badge"><span/>{status === 'live' ? 'LIVE' : 'PREVIEW'}</span></div>
              <div className="prompt-grid">{prompts.map((p,i)=><button key={i} onClick={() => sendText(fr ? p.fr : p.en)} disabled={status !== 'live'}><Sparkles size={14}/>{fr ? p.fr : p.en}<ArrowUpRight size={14}/></button>)}</div>
              <div className="conversation-scroll" aria-live="polite">
                {transcript.length === 0 ? <div className="empty-transcript"><MessageSquareText size={30}/><h4>{fr ? 'Votre conversation commence ici.' : 'The conversation starts here.'}</h4><p>{fr ? 'Activez le microphone. Les réponses de votre conseiller apparaîtront dans cet espace.' : 'Start the microphone. Your consultant’s answers will appear here.'}</p></div> :
                  transcript.map(item=><div className={'bubble-line ' + item.role} key={item.id}><span className="bubble-avatar">{item.role === 'assistant' ? 'A' : '↗'}</span><div className="bubble"><small>{item.role === 'assistant' ? 'ASYT' : fr ? 'VOUS' : 'YOU'}</small><p>{item.text}</p></div></div>)}
              </div>
              <form className="conversation-input" onSubmit={e=>{e.preventDefault();sendText(typed);}}><input value={typed} maxLength={2000} disabled={status !== 'live'} onChange={e=>setTyped(e.target.value)} placeholder={fr ? 'Posez une question à ASYT…' : 'Ask ASYT a question…'} aria-label={fr ? 'Question pour ASYT' : 'Ask ASYT'}/><button disabled={status !== 'live' || !typed.trim()} aria-label="Envoyer"><Send size={17}/></button></form>
              <p className="conversation-disclaimer">{fr ? 'Cette démo est alimentée par Gemini Cloud. Évitez toute information confidentielle.' : 'This demo uses Gemini Cloud. Please avoid confidential information.'}</p>
            </div>
          </div>
        </section>

        <section id="technology" className="technology-section" aria-labelledby="technology-title">
          <div className="section-heading left"><span className="eyebrow muted">02 — OUR APPROACH</span><h2 id="technology-title">{fr ? 'Plus qu’une IA.' : 'More than AI.'}<br/><em>{fr ? 'Une architecture pensée pour vous.' : 'An architecture built around you.'}</em></h2></div>
          <div className="module-grid">{modules.map(item=><article className="module" key={item.id}><div className="module-top"><span>{item.number} / CAPABILITY</span><item.icon size={25}/></div><h3>{fr ? item.titleFr : item.titleEn}</h3><p>{fr ? item.textFr : item.textEn}</p><button onClick={()=>moveTo(item.id as Section)} aria-label={fr ? 'Explorer ce sujet' : 'Explore this topic'}><ArrowUpRight size={20}/></button></article>)}</div>
          <div className="architecture-block">
            <div><span className="eyebrow">ASYT / ARCHITECTURE</span><h3>{fr ? 'De la donnée à la décision.' : 'From data to decisions.'}</h3><p>{fr ? 'Une représentation simplifiée de l’approche technique étudiée pour les solutions ASYT.' : 'A simplified view of the technical approach being developed for ASYT software.'}</p></div>
            <div className="architecture-path"><span><BookOpen/>DOCUMENTS</span><ArrowRight/><span><FileSearch/>RETRIEVAL</span><ArrowRight/><span><Database/>EVIDENCE</span><ArrowRight/><span><Cpu/>LOCAL AI</span></div>
          </div>
        </section>

        <section id="privacy" className="privacy-section">
          <div className="privacy-light"><LockKeyhole size={28}/></div>
          <div className="privacy-copy"><span className="eyebrow muted">03 — PRIVACY FIRST</span><h2>{fr ? 'Vos données ne devraient pas avoir à voyager.' : 'Your data shouldn’t need to travel.'}</h2><p>{fr ? 'ASYT développe une approche de l’intelligence artificielle pensée pour fonctionner au plus près de vos données. La démonstration vocale de ce site, elle, utilise Gemini Cloud et doit être distinguée du logiciel local.' : 'ASYT is developing AI intended to work close to your data. The voice experience on this site uses Gemini Cloud and must not be confused with ASYT’s locally deployed software.'}</p><div className="privacy-highlights"><span><CheckCircle2/>{fr ? 'Architecture locale visée' : 'Local-first design'}</span><span><CheckCircle2/>{fr ? 'Recherche avec preuves' : 'Evidence-based retrieval'}</span><span><CheckCircle2/>{fr ? 'Contrôle des données' : 'Data control'}</span></div></div>
          <div className="privacy-deco" aria-hidden="true"><div/><div/><div/></div>
        </section>

        <section id="diagnostic" className="diagnostic-section">
          <div className="diagnostic-intro"><span className="eyebrow muted">04 — BUSINESS DISCOVERY</span><h2>{fr ? 'Et si on parlait' : 'What if we talked'}<br/><em>{fr ? 'de votre prochain projet ?' : 'about your next project?'}</em></h2><p>{fr ? 'Quelques informations suffisent pour préparer un échange pertinent. Aucun formulaire n’est transmis automatiquement à ASYT.' : 'A few details are enough to prepare a useful discussion. This form does not automatically send anything to ASYT.'}</p><div className="diagnostic-micro"><Globe2/><span>{fr ? 'Sans engagement · Sans transmission automatique' : 'No commitment · No automatic submission'}</span></div></div>
          <form className="diagnostic-form" onSubmit={e=>{e.preventDefault();setSummaryReady(true);}}>
            <div className="field-row"><label>{fr ? 'Entreprise (facultatif)' : 'Company (optional)'}<input maxLength={100} value={lead.company} onChange={e=>setLead(v=>({...v,company:e.target.value}))} placeholder={fr ? 'Nom de votre entreprise' : 'Your company name'}/></label><label>{fr ? 'Votre secteur' : 'Industry'}<select value={lead.industry} onChange={e=>setLead(v=>({...v,industry:e.target.value}))}><option value="">{fr ? 'Sélectionner…' : 'Select…'}</option><option value="Industrie">Industrie</option><option value="Conseil">Conseil</option><option value="Energie">Énergie</option><option value="Santé">Santé</option><option value="Services">Services</option><option value="Autre">Autre</option></select></label></div>
            <div className="field-row"><label>{fr ? 'Utilisateurs potentiels' : 'Potential users'}<select value={lead.team} onChange={e=>setLead(v=>({...v,team:e.target.value}))}><option>1–10</option><option>11–100</option><option>101–500</option><option>500+</option></select></label><label>{fr ? 'Confidentialité' : 'Privacy needs'}<select value={lead.privacy} onChange={e=>setLead(v=>({...v,privacy:e.target.value}))}><option value="local">{fr ? 'Données en local' : 'On-premises data'}</option><option value="hybride">{fr ? 'À étudier' : 'To be assessed'}</option><option value="strict">{fr ? 'Contraintes strictes' : 'Strict requirements'}</option></select></label></div>
            <label>{fr ? 'Quel défi souhaitez-vous résoudre ?' : 'What problem would you like to solve?'}<textarea required maxLength={800} rows={4} value={lead.challenge} onChange={e=>setLead(v=>({...v,challenge:e.target.value}))} placeholder={fr ? 'Recherche documentaire, processus répétitifs, confidentialité… (sans données sensibles)' : 'Document search, repetitive workflows, privacy… (no sensitive information)'}/></label>
            <button className="diagnostic-submit" type="submit">{fr ? 'Préparer mon diagnostic' : 'Prepare my brief'}<ArrowUpRight size={18}/></button>
            {summaryReady && <div className="diagnostic-result" role="status"><strong>{fr ? 'Votre synthèse est prête' : 'Your brief is ready'}</strong><pre>{leadSummary}</pre><div className="diagnostic-result-actions"><button type="button" onClick={()=>void copySummary()}>{copied ? <Check/> : <Copy/>}{copied ? (fr ? 'Copié' : 'Copied') : (fr ? 'Copier' : 'Copy')}</button><button type="button" onClick={downloadSummary}><Download/>{fr ? 'Télécharger' : 'Download'}</button><button type="button" onClick={()=>sendText(leadSummary)} disabled={status !== 'live'}><MessageSquareText/>{fr ? 'En discuter avec ASYT' : 'Discuss with ASYT'}</button></div></div>}
          </form>
        </section>
        <section id="contact" className="contact-section"><span>READY TO EXPLORE?</span><h2>{fr ? 'Votre prochain chapitre commence ici.' : 'Your next chapter starts here.'}</h2><button onClick={()=>moveTo('voice')}>{fr ? 'Échanger avec ASYT' : 'Speak with ASYT'}<ArrowUpRight/></button></section>
      </main>
      <footer className="footer"><div className="footer-brand"><span>A</span> ASYT. <small>EXPERIENCE</small></div><p>{fr ? 'Une expérience commerciale propulsée par Gemini Cloud, distincte de nos solutions d’IA locales.' : 'A Gemini Cloud-powered sales experience, separate from our on-premise AI solutions.'}</p><div>© 2026 ASYT <span>·</span> PARIS, FRANCE</div></footer>
    </div>
  );
}
