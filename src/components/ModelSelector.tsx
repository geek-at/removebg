import React from 'react';
import { MODELS, ModelType } from '../utils/onnxHelper';
import { Check } from 'lucide-react';

interface ModelSelectorProps {
    selectedModel: ModelType | null;
    onSelect: (model: ModelType) => void;
    disabled?: boolean;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({ selectedModel, onSelect, disabled }) => {
    return (
        <div className="model-selector">
            <h3>Select Model</h3>
            <div className="model-grid">
                {(Object.keys(MODELS) as ModelType[]).map((key) => (
                    <button
                        key={key}
                        onClick={() => onSelect(key)}
                        disabled={disabled}
                        className={`model-btn ${selectedModel === key ? 'active' : ''}`}
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            backgroundColor: selectedModel === key ? '#ffe0d0' : 'white',
                            width: '100%',
                            marginBottom: '0.5rem',
                            textAlign: 'left'
                        }}
                    >
                        <span>{MODELS[key].name}</span>
                        {selectedModel === key && <Check size={20} />}
                    </button>
                ))}
            </div>
        </div>
    );
};
