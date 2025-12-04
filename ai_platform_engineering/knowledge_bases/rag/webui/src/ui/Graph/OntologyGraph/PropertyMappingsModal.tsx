import React, { useState, useEffect } from 'react';

export type MatchType = 'exact' | 'prefix' | 'suffix' | 'subset' | 'superset' | 'contains';

export interface PropertyMapping {
    entity_a_property: string;
    entity_b_idkey_property: string;
    match_type: MatchType;
}

interface PropertyMappingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (relationName: string, mappings: PropertyMapping[]) => void;
    heuristicsData: any;
    defaultRelationName?: string;
    entityAType: string;
    entityBType: string;
}

const matchTypeOptions: { value: MatchType; label: string; description: string }[] = [
    { value: 'exact', label: 'Exact Match', description: 'Values must match exactly' },
    { value: 'prefix', label: 'Prefix Match', description: 'Entity A value is a prefix of Entity B value' },
    { value: 'suffix', label: 'Suffix Match', description: 'Entity A value is a suffix of Entity B value' },
    { value: 'subset', label: 'Subset Match', description: 'Entity A value is a subset of Entity B value' },
    { value: 'superset', label: 'Superset Match', description: 'Entity A value is a superset of Entity B value' },
    { value: 'contains', label: 'Contains Match', description: 'Entity A value contains Entity B value' }
];

export default function PropertyMappingsModal({
    isOpen,
    onClose,
    onSubmit,
    heuristicsData,
    defaultRelationName = 'related_to',
    entityAType,
    entityBType
}: PropertyMappingsModalProps) {
    const [relationName, setRelationName] = useState(defaultRelationName);
    const [mappings, setMappings] = useState<PropertyMapping[]>([]);
    const [errors, setErrors] = useState<string[]>([]);
    const [relationNameError, setRelationNameError] = useState('');

    // Initialize mappings from heuristics data
    useEffect(() => {
        if (isOpen) {
            // Reset relation name to default
            setRelationName(defaultRelationName);
            setRelationNameError('');
            
            if (heuristicsData?.property_mappings) {
                const initialMappings = heuristicsData.property_mappings.map((pm: any) => ({
                    entity_a_property: pm.entity_a_property,
                    entity_b_idkey_property: pm.entity_b_idkey_property,
                    match_type: pm.match_type || 'exact' // Default to exact if not provided
                }));
                setMappings(initialMappings);
                setErrors(new Array(initialMappings.length).fill(''));
            }
        }
    }, [isOpen, heuristicsData, defaultRelationName]);

    const handleMatchTypeChange = (index: number, matchType: MatchType) => {
        const newMappings = [...mappings];
        newMappings[index].match_type = matchType;
        setMappings(newMappings);
        
        // Clear error for this field
        const newErrors = [...errors];
        newErrors[index] = '';
        setErrors(newErrors);
    };

    const handleSubmit = () => {
        // Validate relation name
        if (!relationName || relationName.trim() === '') {
            setRelationNameError('Relation name is required');
            return;
        }
        
        // Validate all mappings have match_type selected
        const newErrors = mappings.map((mapping) => 
            !mapping.match_type ? 'Please select a match type' : ''
        );
        
        if (newErrors.some(error => error !== '')) {
            setErrors(newErrors);
            return;
        }

        onSubmit(relationName.trim(), mappings);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center" style={{ zIndex: 2000 }}>
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900">Accept Relation</h3>
                        <p className="text-xs text-gray-500 mt-1">
                            {entityAType} → {entityBType}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                        title="Close"
                    >
                        ×
                    </button>
                </div>

                {/* Content */}
                <div className="px-6 py-4 overflow-y-auto flex-1">
                    {/* Relation Name Input */}
                    <div className="mb-6">
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                            Relation Name <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={relationName}
                            onChange={(e) => {
                                setRelationName(e.target.value);
                                if (relationNameError) setRelationNameError('');
                            }}
                            placeholder="e.g., works_in, manages, belongs_to"
                            className={`w-full px-3 py-2 border ${relationNameError ? 'border-red-500' : 'border-gray-300'} rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500`}
                        />
                        {relationNameError && (
                            <p className="mt-1 text-sm text-red-600">{relationNameError}</p>
                        )}
                        <p className="mt-1 text-xs text-gray-500">
                            The name of the relationship between these entity types
                        </p>
                    </div>

                    {/* Property Mappings Section */}
                    <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">Property Mappings</h4>
                        <p className="text-sm text-gray-700 mb-4">
                            Select the match type for each property mapping. This determines how values should be compared when creating relations.
                        </p>
                    </div>

                    {mappings.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            No property mappings found in heuristics data.
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {mappings.map((mapping, index) => (
                                <div 
                                    key={index} 
                                    className={`border rounded-lg p-4 ${errors[index] ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50'}`}
                                >
                                    <div className="flex items-start gap-4 mb-3">
                                        <div className="flex-1">
                                            <label className="block text-xs font-semibold text-gray-700 mb-1">
                                                {entityAType} Property
                                            </label>
                                            <div className="px-3 py-2 bg-white border border-gray-300 rounded text-sm font-mono">
                                                {mapping.entity_a_property}
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-center pt-6">
                                            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                        </div>
                                        <div className="flex-1">
                                            <label className="block text-xs font-semibold text-gray-700 mb-1">
                                                {entityBType} Property
                                            </label>
                                            <div className="px-3 py-2 bg-white border border-gray-300 rounded text-sm font-mono">
                                                {mapping.entity_b_idkey_property}
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-semibold text-gray-700 mb-2">
                                            Match Type <span className="text-red-500">*</span>
                                        </label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {matchTypeOptions.map((option) => (
                                                <button
                                                    key={option.value}
                                                    type="button"
                                                    onClick={() => handleMatchTypeChange(index, option.value)}
                                                    className={`text-left px-3 py-2 rounded border text-sm transition-colors ${
                                                        mapping.match_type === option.value
                                                            ? 'border-indigo-500 bg-indigo-50 text-indigo-900'
                                                            : 'border-gray-300 bg-white text-gray-700 hover:border-indigo-300 hover:bg-indigo-50'
                                                    }`}
                                                >
                                                    <div className="font-semibold">{option.label}</div>
                                                    <div className="text-xs text-gray-600 mt-0.5">{option.description}</div>
                                                </button>
                                            ))}
                                        </div>
                                        {errors[index] && (
                                            <p className="text-xs text-red-600 mt-1">{errors[index]}</p>
                                        )}
                                    </div>

                                    {/* Show example values if available */}
                                    {heuristicsData?.example_matches?.[0] && (
                                        <div className="mt-3 pt-3 border-t border-gray-200">
                                            <p className="text-xs font-semibold text-gray-700 mb-1">Example Values:</p>
                                            <div className="grid grid-cols-2 gap-2 text-xs">
                                                <div>
                                                    <span className="text-gray-500">Entity A:</span>
                                                    <code className="ml-1 px-1 py-0.5 bg-gray-100 rounded">
                                                        {heuristicsData.example_matches[0]?.entity_a_values?.[mapping.entity_a_property] || 'N/A'}
                                                    </code>
                                                </div>
                                                <div>
                                                    <span className="text-gray-500">Entity B:</span>
                                                    <code className="ml-1 px-1 py-0.5 bg-gray-100 rounded">
                                                        {heuristicsData.example_matches[0]?.entity_b_values?.[mapping.entity_b_idkey_property] || 'N/A'}
                                                    </code>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm rounded bg-gray-500 hover:bg-gray-600 text-white transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={mappings.length === 0}
                        className="px-4 py-2 text-sm rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                    >
                        Accept Relation
                    </button>
                </div>
            </div>
        </div>
    );
}

