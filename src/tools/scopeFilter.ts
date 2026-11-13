import type { Tool } from '@modelcontextprotocol/sdk/types.js'

type SecurityRequirement = Record<string, string[] | undefined>

interface OperationLike {
  operationId?: string
  security?: SecurityRequirement[]
}

export interface SpecLike {
  paths?: Record<string, Record<string, OperationLike | undefined> | undefined>
}

/** A tool that the granted scopes do not allow to use. */
export interface UnavailableTool {
  name: string
  description: string
  scopes: string[]
  /** Whether one of the scopes is enough, or all of them are needed */
  needs: 'any' | 'all'
}

export interface SelectedTools {
  ids: string[]
  names: string[]
  unavailable: UnavailableTool[]
  /** The scopes of every operation of the spec, see scopesByOperation */
  operationScopes: Map<string, string[]>
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

/** Lowercase and strip separators so `get-block-by-id` matches `getBlockById`. */
export function normalizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function parseScopes(scope: string): string[] {
  return scope.split(/\s+/).filter(Boolean)
}

/** The scopes declared by every operation of the spec, by normalized operationId. */
export function scopesByOperation(spec: SpecLike | undefined): Map<string, string[]> {
  const result = new Map<string, string[]>()

  for (const pathItem of Object.values(spec?.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem?.[method]
      if (!operation?.operationId) continue

      const scopes = (operation.security ?? []).flatMap((requirement) =>
        Object.values(requirement).flatMap((list) => list ?? [])
      )
      result.set(normalizeId(operation.operationId), scopes)
    }
  }

  return result
}

/**
 * Concrete CMS accepts a token that has any of the scopes of an operation.
 * An operation that declares no scopes is kept: hiding a tool we know nothing
 * about is worse than showing one that may fail.
 */
export function isOperationAllowed(required: string[] | undefined, granted: string[]): boolean {
  if (!required || required.length === 0) {
    return true
  }
  return required.some((scope) => granted.includes(scope))
}

/**
 * For the tools that call several operations: the scopes still to be granted,
 * one for every operation that the granted scopes do not allow to call.
 */
export function missingScopes(
  operationIds: string[],
  operationScopes: Map<string, string[]>,
  granted: string[]
): string[] {
  const missing = new Set<string>()

  for (const operationId of operationIds) {
    const required = operationScopes.get(normalizeId(operationId))
    if (required && !isOperationAllowed(required, granted)) {
      // Any scope of the operation is enough: suggest the first one
      missing.add(required[0])
    }
  }

  return [...missing]
}

/** Split the generated tools between the ones the granted scopes allow to use, and the others. */
export function selectGeneratedTools(
  toolsWithIds: Array<[string, Tool]>,
  spec: SpecLike | undefined,
  granted: string[]
): SelectedTools {
  const operationScopes = scopesByOperation(spec)
  const selected: SelectedTools = { ids: [], names: [], unavailable: [], operationScopes }

  for (const [id, tool] of toolsWithIds) {
    const required = operationScopes.get(normalizeId(tool.name))
    if (isOperationAllowed(required, granted)) {
      selected.ids.push(id)
      selected.names.push(tool.name)
    } else {
      selected.unavailable.push({
        name: tool.name,
        description: tool.description ?? '',
        scopes: required ?? [],
        needs: 'any',
      })
    }
  }

  return selected
}

function describeScopes(tool: UnavailableTool): string {
  const list = tool.scopes.map((scope) => `\`${scope}\``).join(', ')
  if (tool.scopes.length === 1) {
    return `It needs the ${list} scope.`
  }
  return tool.needs === 'any'
    ? `It needs one of these scopes: ${list}.`
    : `It needs these scopes: ${list}.`
}

/**
 * What the AI agent reads when it asks for the tools it cannot see.
 * `tools` is null when the scopes of the tools could not be checked.
 */
export function formatUnavailableTools(tools: UnavailableTool[] | null): string {
  if (tools === null) {
    return 'The connector could not check the scopes of the tools: all of them are shown, but some may not work.'
  }
  if (tools.length === 0) {
    return 'No tools are hidden: the scopes of the connector allow to use all of them.'
  }

  const lines = [
    'These tools are hidden, because the scopes of the connector do not allow to use them.',
    'To use one of them, its scope must be added to the scopes of the connector (the CONCRETE_API_SCOPE setting) and allowed in the API integration of Concrete CMS: then the user has to authorize the connector again.',
    '',
  ]
  for (const tool of tools) {
    let description = tool.description.trim()
    if (description && !/[.!?]$/.test(description)) {
      description += '.'
    }
    lines.push(`- ${tool.name}:${description ? ` ${description}` : ''} ${describeScopes(tool)}`)
  }

  return lines.join('\n')
}
