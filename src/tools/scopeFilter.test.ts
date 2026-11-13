import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import {
  formatUnavailableTools,
  isOperationAllowed,
  missingScopes,
  parseScopes,
  scopesByOperation,
  selectGeneratedTools,
  type SpecLike,
} from './scopeFilter.js'

const spec: SpecLike = {
  paths: {
    '/ccm/api/1.0/pages': {
      get: { operationId: 'getPages', security: [{ authorization: ['pages:read'] }] },
      post: { operationId: 'addPage', security: [{ authorization: ['pages:add'] }] },
    },
    '/ccm/api/1.0/files': {
      // Concrete CMS accepts a token having any of these
      get: {
        operationId: 'getFiles',
        security: [{ authorization: ['files:read', 'files:admin'] }],
      },
    },
    '/ccm/api/1.0/public': {
      get: { operationId: 'getPublicThing' },
    },
  },
}

function tool(name: string, description?: string): [string, Tool] {
  return [`ID::${name}`, { name, description, inputSchema: { type: 'object', properties: {} } }]
}

const tools = [
  tool('get-pages', 'Returns a list of page objects.'),
  tool('add-page', 'Adds a page object.'),
  tool('get-files'),
  tool('get-public-thing'),
  tool('not-in-the-spec'),
]

describe('parseScopes', () => {
  it('splits the scopes on any white space', () => {
    assert.deepEqual(parseScopes(' pages:read  files:read\n'), ['pages:read', 'files:read'])
    assert.deepEqual(parseScopes(''), [])
  })
})

describe('scopesByOperation', () => {
  it('reads the scopes of every operation', () => {
    const scopes = scopesByOperation(spec)

    assert.deepEqual(scopes.get('getpages'), ['pages:read'])
    assert.deepEqual(scopes.get('getfiles'), ['files:read', 'files:admin'])
    assert.deepEqual(scopes.get('getpublicthing'), [])
    assert.equal(scopes.size, 4)
  })

  it('accepts a spec without paths', () => {
    assert.equal(scopesByOperation(undefined).size, 0)
    assert.equal(scopesByOperation({}).size, 0)
  })
})

describe('isOperationAllowed', () => {
  it('needs just one of the scopes of the operation', () => {
    assert.equal(isOperationAllowed(['files:read', 'files:admin'], ['files:admin']), true)
    assert.equal(isOperationAllowed(['files:read', 'files:admin'], ['pages:read']), false)
  })

  it('keeps the operations that declare no scopes', () => {
    assert.equal(isOperationAllowed([], []), true)
    assert.equal(isOperationAllowed(undefined, []), true)
  })
})

describe('missingScopes', () => {
  const operationScopes = scopesByOperation(spec)

  it('needs a scope for every operation', () => {
    assert.deepEqual(missingScopes(['getPages', 'addPage'], operationScopes, ['pages:read']), [
      'pages:add',
    ])
    assert.deepEqual(missingScopes(['getPages', 'addPage'], operationScopes, []), [
      'pages:read',
      'pages:add',
    ])
    assert.deepEqual(
      missingScopes(['getPages', 'addPage'], operationScopes, ['pages:add', 'pages:read']),
      []
    )
  })

  it('reads the scopes from the spec in use', () => {
    const otherSpec: SpecLike = {
      paths: {
        '/ccm/api/1.0/pages': {
          post: { operationId: 'addPage', security: [{ authorization: ['pages:create'] }] },
        },
      },
    }

    assert.deepEqual(missingScopes(['addPage'], scopesByOperation(otherSpec), ['pages:add']), [
      'pages:create',
    ])
  })

  it('suggests one scope when any of them is enough', () => {
    assert.deepEqual(missingScopes(['getFiles'], operationScopes, []), ['files:read'])
    assert.deepEqual(missingScopes(['getFiles'], operationScopes, ['files:admin']), [])
  })

  it('lists a scope once, and ignores the operations it knows nothing about', () => {
    assert.deepEqual(
      missingScopes(
        ['getPages', 'getPages', 'getPublicThing', 'notInTheSpec'],
        operationScopes,
        []
      ),
      ['pages:read']
    )
  })
})

describe('selectGeneratedTools', () => {
  it('keeps the tools that the scopes allow to use', () => {
    const selected = selectGeneratedTools(tools, spec, ['pages:read', 'files:admin'])

    assert.deepEqual(selected.names, [
      'get-pages',
      'get-files',
      'get-public-thing',
      'not-in-the-spec',
    ])
    assert.deepEqual(selected.ids, [
      'ID::get-pages',
      'ID::get-files',
      'ID::get-public-thing',
      'ID::not-in-the-spec',
    ])
  })

  it('tells which tools are left out, and the scopes they need', () => {
    const selected = selectGeneratedTools(tools, spec, ['pages:read'])

    assert.deepEqual(selected.unavailable, [
      { name: 'add-page', description: 'Adds a page object.', scopes: ['pages:add'], needs: 'any' },
      { name: 'get-files', description: '', scopes: ['files:read', 'files:admin'], needs: 'any' },
    ])
  })

  it('leaves out every tool that needs a scope when no scope matches', () => {
    const selected = selectGeneratedTools(tools, spec, ['something:else'])

    assert.deepEqual(selected.names, ['get-public-thing', 'not-in-the-spec'])
    assert.equal(selected.unavailable.length, 3)
  })
})

describe('formatUnavailableTools', () => {
  it('tells when no tool is hidden', () => {
    assert.equal(
      formatUnavailableTools([]),
      'No tools are hidden: the scopes of the connector allow to use all of them.'
    )
  })

  it('tells when the scopes of the tools could not be checked', () => {
    assert.match(formatUnavailableTools(null), /could not check the scopes of the tools/)
  })

  it('lists every tool with the scopes it needs', () => {
    const report = formatUnavailableTools([
      { name: 'add-page', description: 'Adds a page object.', scopes: ['pages:add'], needs: 'any' },
      { name: 'get-files', description: '', scopes: ['files:read', 'files:admin'], needs: 'any' },
      { name: 'get-block', description: 'Find a block', scopes: ['blocks:read'], needs: 'any' },
      {
        name: 'update_page_content',
        description: 'Update page block content safely.',
        scopes: ['pages:update', 'pages:areas:update_blocks'],
        needs: 'all',
      },
    ])
    const lines = report.split('\n')

    assert.match(lines[0], /^These tools are hidden/)
    assert.match(lines[1], /CONCRETE_API_SCOPE/)
    assert.deepEqual(lines.slice(3), [
      '- add-page: Adds a page object. It needs the `pages:add` scope.',
      '- get-files: It needs one of these scopes: `files:read`, `files:admin`.',
      '- get-block: Find a block. It needs the `blocks:read` scope.',
      '- update_page_content: Update page block content safely. It needs these scopes: `pages:update`, `pages:areas:update_blocks`.',
    ])
  })
})
