import { describe, expect, it } from 'vitest';

import { expandUriTemplate, listUriTemplateVariables } from './uri-template.js';

describe('uri-template', () => {
  it('expands simple and query expressions', () => {
    expect(
      expandUriTemplate('repo://{owner}/{repo}{?path,ref}', {
        owner: 'gybob',
        repo: 'aai-gateway',
        path: 'docs/aai-design.md',
        ref: 'main',
      }),
    ).toBe('repo://gybob/aai-gateway?path=docs%2Faai-design.md&ref=main');
  });

  it('lists template variables without duplicates', () => {
    expect(listUriTemplateVariables('repo://{owner}/{repo}{?path,ref}{&ref}')).toEqual([
      'owner',
      'repo',
      'path',
      'ref',
    ]);
  });
});
