/**
 * Tests for AgentLogos component and utilities
 * Covers AGENT_LOGOS, normalizeAgentName, getAgentLogo, AgentLogo component
 */

import { render, screen } from '@testing-library/react';
import {
  AGENT_LOGOS,
  normalizeAgentName,
  getAgentLogo,
  AgentLogo,
} from '../AgentLogos';

describe('AGENT_LOGOS', () => {
  const expectedAgents = [
    'argocd',
    'argo',
    'aws',
    'github',
    'jira',
    'splunk',
    'pagerduty',
    'confluence',
    'kubernetes',
    'caipe',
    'supervisor',
    'rag',
    'knowledge',
  ];

  it('has all expected agents', () => {
    expectedAgents.forEach((agent) => {
      expect(AGENT_LOGOS).toHaveProperty(agent);
    });
  });

  it('each has name, displayName, color, icon', () => {
    Object.values(AGENT_LOGOS).forEach((config) => {
      expect(config).toHaveProperty('name');
      expect(config).toHaveProperty('displayName');
      expect(config).toHaveProperty('color');
      expect(config).toHaveProperty('icon');
      expect(typeof config.name).toBe('string');
      expect(typeof config.displayName).toBe('string');
      expect(typeof config.color).toBe('string');
      expect(config.icon).toBeDefined();
    });
  });
});

describe('normalizeAgentName', () => {
  it('argocd → argocd', () => {
    expect(normalizeAgentName('argocd')).toBe('argocd');
  });

  it('ArgoCD → argocd', () => {
    expect(normalizeAgentName('ArgoCD')).toBe('argocd');
  });

  it('argo → argocd', () => {
    expect(normalizeAgentName('argo')).toBe('argocd');
  });

  it('aws → aws', () => {
    expect(normalizeAgentName('aws')).toBe('aws');
  });

  it('amazon → aws', () => {
    expect(normalizeAgentName('amazon')).toBe('aws');
  });

  it('github → github', () => {
    expect(normalizeAgentName('github')).toBe('github');
  });

  it('git → github', () => {
    expect(normalizeAgentName('git')).toBe('github');
  });

  it('jira → jira', () => {
    expect(normalizeAgentName('jira')).toBe('jira');
  });

  it('k8s → kubernetes', () => {
    expect(normalizeAgentName('k8s')).toBe('kubernetes');
  });

  it('pd → pagerduty', () => {
    expect(normalizeAgentName('pd')).toBe('pagerduty');
  });

  it('platform → caipe', () => {
    expect(normalizeAgentName('platform')).toBe('caipe');
  });

  it('knowledge base → rag', () => {
    expect(normalizeAgentName('knowledge base')).toBe('rag');
  });

  it('unknown → unknown', () => {
    expect(normalizeAgentName('unknown')).toBe('unknown');
  });
});

describe('getAgentLogo', () => {
  it('returns config for known agent', () => {
    expect(getAgentLogo('argocd')).toEqual(AGENT_LOGOS.argocd);
    expect(getAgentLogo('aws')).toEqual(AGENT_LOGOS.aws);
    expect(getAgentLogo('github')).toEqual(AGENT_LOGOS.github);
  });

  it('returns null for unknown agent', () => {
    expect(getAgentLogo('nonexistent')).toBeNull();
    expect(getAgentLogo('random-agent')).toBeNull();
  });

  it('handles case-insensitive lookup', () => {
    expect(getAgentLogo('ARGOCD')).toEqual(AGENT_LOGOS.argocd);
    expect(getAgentLogo('AWS')).toEqual(AGENT_LOGOS.aws);
    expect(getAgentLogo('Github')).toEqual(AGENT_LOGOS.github);
  });
});

describe('AgentLogo component', () => {
  it('renders SVG for known agent', () => {
    const { container } = render(<AgentLogo agent="argocd" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders fallback letter for unknown agent', () => {
    render(<AgentLogo agent="custom" />);
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('hides when showFallback=false and unknown', () => {
    const { container } = render(<AgentLogo agent="unknown" showFallback={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('applies size classes: sm, md, lg', () => {
    const { container: c1 } = render(<AgentLogo agent="argocd" size="sm" />);
    const { container: c2 } = render(<AgentLogo agent="argocd" size="md" />);
    const { container: c3 } = render(<AgentLogo agent="argocd" size="lg" />);

    expect(c1.querySelector('.w-4')).toBeInTheDocument();
    expect(c2.querySelector('.w-5')).toBeInTheDocument();
    expect(c3.querySelector('.w-6')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <AgentLogo agent="argocd" className="custom-class" />
    );
    expect(container.querySelector('.custom-class')).toBeInTheDocument();
  });

  it('renders with title for known agent', () => {
    const { container } = render(<AgentLogo agent="argocd" />);
    const wrapper = container.querySelector('[title="ArgoCD"]');
    expect(wrapper).toBeInTheDocument();
  });
});
