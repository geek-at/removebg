import React from 'react';
import { TIERS, TIER_ORDER, TierId } from '../models';
import { Check } from 'lucide-react';

interface ModelSelectorProps {
    selectedTier: TierId;
    onSelect: (tier: TierId) => void;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({ selectedTier, onSelect }) => {
    return (
        <div className="model-selector">
            <h3>Select Quality</h3>
            <div className="model-grid">
                {TIER_ORDER.map((id) => {
                    const tier = TIERS[id];
                    const active = selectedTier === id;
                    return (
                        <button
                            key={id}
                            onClick={() => onSelect(id)}
                            className={`model-btn ${active ? 'active' : ''}`}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: '0.5rem',
                                backgroundColor: active ? '#ffe0d0' : 'white',
                                width: '100%',
                                marginBottom: '0.5rem',
                                textAlign: 'left'
                            }}
                        >
                            <span>
                                {tier.name}
                                <br />
                                <small style={{ fontWeight: 'normal', textTransform: 'none', letterSpacing: 0 }}>
                                    {tier.hint} · ~{tier.downloadMB} MB
                                </small>
                            </span>
                            {active && <Check size={20} style={{ flexShrink: 0 }} />}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
