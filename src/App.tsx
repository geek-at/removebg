import { useState, useEffect } from 'react';
import { ModelSelector } from './components/ModelSelector';
import { ImageUploader } from './components/ImageUploader';
import { loadModel, runInference, MODELS, ModelType } from './utils/onnxHelper';
import { processImage, applyMask } from './utils/imageProcessing';
import { Loader2, Download } from 'lucide-react';

function App() {
    const [selectedModel, setSelectedModel] = useState<ModelType | null>(null);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
    const [processedImageUrl, setProcessedImageUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');
    const [progress, setProgress] = useState(0);

    const handleModelSelect = async (model: ModelType) => {
        if (loading) return;
        setSelectedModel(model);
    };

    useEffect(() => {
        if (selectedModel && imageFile) {
            process();
        }
    }, [selectedModel, imageFile]);

    const process = async () => {
        if (!selectedModel || !imageFile) return;

        setLoading(true);
        setProcessedImageUrl(null);

        try {
            setStatus(`Loading model ${MODELS[selectedModel].name}...`);
            await loadModel(selectedModel, (p) => setProgress(p * 100));

            setStatus('Processing image...');
            const targetSize = MODELS[selectedModel].size;
            const modelCategory = selectedModel.startsWith('rmbg') ? 'rmbg' : selectedModel as 'u2netp' | 'silueta';
            const { tensor, originalImage } = await processImage(imageFile, targetSize, modelCategory);

            setStatus('Running inference...');
            const start = performance.now();
            const outputTensor = await runInference(tensor);
            const end = performance.now();
            console.log(`Inference time: ${(end - start).toFixed(2)}ms`);

            setStatus('Applying mask...');
            const resultUrl = applyMask(originalImage, outputTensor, targetSize);

            setProcessedImageUrl(resultUrl);
            setStatus(`Done in ${(end - start).toFixed(0)}ms`);
        } catch (e) {
            console.error(e);
            setStatus('Error: ' + (e as Error).message);
        } finally {
            setLoading(false);
            setProgress(0);
        }
    };

    const handleImageSelect = (file: File) => {
        setImageFile(file);
        setOriginalImageUrl(URL.createObjectURL(file));
        setProcessedImageUrl(null);
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
                        <ModelSelector
                            selectedModel={selectedModel}
                            onSelect={handleModelSelect}
                            disabled={loading}
                        />
                    </div>

                    <div className="card">
                        <h3>Status</h3>
                        <div style={{ minHeight: '3rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {loading && <Loader2 className="spin" />}
                            <span>{status || 'Ready'}</span>
                        </div>
                        {loading && progress > 0 && progress < 100 && (
                            <div style={{ width: '100%', height: '10px', border: '2px solid black', marginTop: '0.5rem' }}>
                                <div style={{ width: `${progress}%`, height: '100%', background: 'black' }}></div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="main-content">
                    {!originalImageUrl ? (
                        <div className="card" style={{ minHeight: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <ImageUploader onImageSelect={handleImageSelect} disabled={loading} />
                        </div>
                    ) : (
                        <div className="results">
                            <div className="card" style={{ position: 'relative' }}>
                                <button
                                    onClick={() => {
                                        setImageFile(null);
                                        setOriginalImageUrl(null);
                                        setProcessedImageUrl(null);
                                        setStatus('');
                                    }}
                                    style={{ position: 'absolute', top: '1rem', right: '1rem', zIndex: 10, padding: '0.5rem' }}
                                    disabled={loading}
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
