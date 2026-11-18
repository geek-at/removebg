import { useState, useEffect, useRef } from 'react';
import { ModelSelector } from './components/ModelSelector';
import { ImageUploader } from './components/ImageUploader';
import { removeBackground } from './inferenceClient';
import { TierId } from './models';
import { Loader2, Download } from 'lucide-react';

function App() {
    const [selectedTier, setSelectedTier] = useState<TierId>('balanced');
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
    const [processedImageUrl, setProcessedImageUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');
    const [progress, setProgress] = useState<number | null>(null);

    // Object URLs hold the image in memory until revoked.
    const originalUrlRef = useRef<string | null>(null);
    const processedUrlRef = useRef<string | null>(null);

    const showOriginal = (file: File | null) => {
        if (originalUrlRef.current) URL.revokeObjectURL(originalUrlRef.current);
        originalUrlRef.current = file ? URL.createObjectURL(file) : null;
        setOriginalImageUrl(originalUrlRef.current);
    };

    const showProcessed = (blob: Blob | null) => {
        if (processedUrlRef.current) URL.revokeObjectURL(processedUrlRef.current);
        processedUrlRef.current = blob ? URL.createObjectURL(blob) : null;
        setProcessedImageUrl(processedUrlRef.current);
    };

    useEffect(() => {
        if (!imageFile) return;
        let stale = false;

        setLoading(true);
        setProgress(null);
        setStatus('Starting...');
        showProcessed(null);

        removeBackground(imageFile, selectedTier, (text, p) => {
            if (stale) return;
            setStatus(text);
            setProgress(p);
        })
            .then((result) => {
                if (stale) return;
                showProcessed(result.blob);
                const where = result.backend === 'webgpu' ? 'GPU' : 'CPU';
                setStatus(`Done in ${result.inferenceMs.toFixed(0)} ms · ${where}`);
                setLoading(false);
                setProgress(null);
            })
            .catch((e: Error) => {
                // A newer image or quality choice replaced this run.
                if (stale || e.message === 'superseded') return;
                console.error(e);
                setStatus('Error: ' + e.message);
                setLoading(false);
                setProgress(null);
            });

        return () => {
            stale = true;
        };
    }, [selectedTier, imageFile]);

    const handleImageSelect = (file: File) => {
        setImageFile(file);
        showOriginal(file);
    };

    const handleClear = () => {
        setImageFile(null);
        showOriginal(null);
        showProcessed(null);
        setLoading(false);
        setProgress(null);
        setStatus('');
    };

    return (
        <div className="container">
            <header style={{ marginBottom: '3rem', borderBottom: '3px solid black', paddingBottom: '1rem' }}>
                <h1 style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>REMOVE BG</h1>
                <p style={{ fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    Local Privacy-First Background Remover
                </p>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '2rem' }}>
                <div className="sidebar">
                    <div className="card">
                        <ModelSelector selectedTier={selectedTier} onSelect={setSelectedTier} />
                    </div>

                    <div className="card">
                        <h3>Status</h3>
                        <div style={{ minHeight: '3rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {loading && <Loader2 className="spin" />}
                            <span>{status || 'Ready'}</span>
                        </div>
                        {loading && progress !== null && (
                            <div style={{ width: '100%', height: '10px', border: '2px solid black', marginTop: '0.5rem' }}>
                                <div style={{ width: `${progress * 100}%`, height: '100%', background: 'black' }}></div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="main-content">
                    {!originalImageUrl ? (
                        <div className="card" style={{ minHeight: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <ImageUploader onImageSelect={handleImageSelect} />
                        </div>
                    ) : (
                        <div className="results">
                            <div className="card" style={{ position: 'relative' }}>
                                <button
                                    onClick={handleClear}
                                    style={{ position: 'absolute', top: '1rem', right: '1rem', zIndex: 10, padding: '0.5rem' }}
                                >
                                    X
                                </button>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                    <div>
                                        <h3>Original</h3>
                                        <img src={originalImageUrl} alt="Original" style={{ width: '100%', border: '2px solid black' }} />
                                    </div>
                                    <div>
                                        <h3>Result</h3>
                                        {processedImageUrl ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                                <img src={processedImageUrl} alt="Processed" style={{ width: '100%', border: '2px solid black', background: 'url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAAXNSR0IArs4c6QAAACVJREFUKFNjTc3O/s9AAWDh4uRkZGBgYCCuH10t0jCgWj5o2kIAWw4v0/017R4AAAAASUVORK5CYII=)' }} />
                                                <a href={processedImageUrl} download="removed-bg.png" style={{ textDecoration: 'none' }}>
                                                    <button style={{ width: '100%', display: 'flex', justifyContent: 'center', gap: '0.5rem' }}>
                                                        <Download /> Download
                                                    </button>
                                                </a>
                                            </div>
                                        ) : (
                                            <div style={{ width: '100%', aspectRatio: '1', border: '2px dashed black', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eee' }}>
                                                {loading ? <Loader2 className="spin" size={48} /> : <span>Waiting for processing...</span>}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <style>{`
        .spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @media (max-width: 768px) {
          div[style*="grid-template-columns"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
        </div>
    )
}

export default App
