import { describe, expect, it } from 'vitest';
import {
  CUSTOM_PROVIDER_ID,
  DEFAULT_PROVIDER_ID,
  PROVIDERS,
  PROVIDER_GROUPS,
  hasFixedUrl,
  providerPreset,
} from './providers';
import { modelsUrl } from './model-client';

const presets = PROVIDERS.filter((p) => p.id !== CUSTOM_PROVIDER_ID);

describe('the provider table', () => {
  it('has unique ids and names', () => {
    expect(new Set(PROVIDERS.map((p) => p.id)).size).toBe(PROVIDERS.length);
    expect(new Set(PROVIDERS.map((p) => p.name)).size).toBe(PROVIDERS.length);
  });

  it('gives every preset a URL that parses and does not end in a slash', () => {
    for (const preset of presets) {
      expect(() => new URL(preset.baseUrl), preset.id).not.toThrow();
      expect(preset.baseUrl, preset.id).not.toMatch(/\/$/);
      expect(preset.baseUrl, preset.id).not.toMatch(/\/chat\/completions$/);
    }
  });

  it('sends hosted keys over https, and only reaches http for localhost', () => {
    for (const preset of presets) {
      const url = new URL(preset.baseUrl);
      if (url.protocol === 'http:') expect(url.hostname, preset.id).toBe('localhost');
      else expect(url.protocol, preset.id).toBe('https:');
    }
  });

  it('points every key link at an https page', () => {
    for (const preset of PROVIDERS) {
      if (!preset.keyUrl) continue;
      expect(new URL(preset.keyUrl).protocol, preset.id).toBe('https:');
    }
  });

  it('offers a key link, or says the key is optional, for every provider', () => {
    for (const preset of PROVIDERS) {
      expect(!!preset.keyUrl || !!preset.keyOptional, preset.id).toBe(true);
    }
  });

  it('lists every preset in exactly one group of the select', () => {
    const listed = PROVIDER_GROUPS.flatMap((g) => g.providers.map((p) => p.id));
    expect(listed.sort()).toEqual(PROVIDERS.map((p) => p.id).sort());
  });

  it('reads an unknown or missing id as Custom, which keeps the URL it was given', () => {
    expect(providerPreset(undefined).id).toBe(CUSTOM_PROVIDER_ID);
    expect(providerPreset('a-provider-from-2027').id).toBe(CUSTOM_PROVIDER_ID);
    expect(hasFixedUrl(providerPreset(CUSTOM_PROVIDER_ID))).toBe(false);
    expect(hasFixedUrl(providerPreset(DEFAULT_PROVIDER_ID))).toBe(true);
  });
});

describe('the /models call each row asks for', () => {
  it('is plain for a provider with no query of its own', () => {
    const openai = providerPreset('openai');
    expect(modelsUrl(openai.baseUrl, openai)).toBe('https://api.openai.com/v1/models');
  });

  it('carries NanoGPT’s ?detailed=true', () => {
    const nano = providerPreset(DEFAULT_PROVIDER_ID);
    expect(modelsUrl(nano.baseUrl, nano)).toBe('https://nano-gpt.com/api/v1/models?detailed=true');
  });

  it('tidies a hand-typed URL before appending to it', () => {
    const custom = providerPreset(CUSTOM_PROVIDER_ID);
    expect(modelsUrl('  http://localhost:8080/v1/  ', custom)).toBe(
      'http://localhost:8080/v1/models',
    );
  });
});

describe('the two quirks that are not URLs', () => {
  it('lets Anthropic answer a browser at all', () => {
    expect(providerPreset('anthropic').headers).toMatchObject({
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
  });

  it('credits the app to the aggregators that ask for it', () => {
    for (const id of ['openrouter', 'aimlapi']) {
      expect(providerPreset(id).headers?.['X-Title'], id).toBe('MagicStories');
    }
  });

  it('strips Gemini’s models/ prefix and nothing else', () => {
    expect(providerPreset('google').stripModelPrefix).toBe('models/');
    expect(providerPreset('openai').stripModelPrefix).toBeUndefined();
  });

  it('carries a list for the one provider that publishes none', () => {
    const perplexity = providerPreset('perplexity');
    expect(perplexity.modelsFixed?.length).toBeGreaterThan(0);
    expect(perplexity.modelsFixed?.map((m) => m.id)).toContain('sonar');
    // Everyone else fetches; a built-in list would go stale unnoticed.
    expect(presets.filter((p) => p.modelsFixed).map((p) => p.id)).toEqual(['perplexity']);
  });
});
