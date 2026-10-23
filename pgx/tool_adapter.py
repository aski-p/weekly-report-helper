"""Compatibility for Qwen XML tool gateways that omit schemas or stringify JSON."""
import copy
import json


def prepare_request(body):
    result = copy.deepcopy(body)
    tools = result.get('tools') or []
    if tools:
        definitions = [t.get('function', {}) for t in tools if isinstance(t, dict)]
        choice = (result.get('tool_choice') or {})
        forced = choice.get('function', {}).get('name') if isinstance(choice, dict) else None
        hint = 'Use the exact tool names and JSON schemas below. Do not rename fields. Array/object parameter values must be raw valid JSON without extra string escaping or markdown. '
        if forced:
            hint += 'You must call ' + forced + '. '
        hint += json.dumps(definitions, ensure_ascii=False)
        result['messages'] = [{'role':'system','content':hint}, *result.get('messages', [])]
    return result


def normalize(value, schema):
    types = schema.get('type', [])
    if isinstance(types, str):
        types = [types]
    if value == 'null' and 'null' in types:
        return None
    if value is None and 'null' in types:
        return None
    if isinstance(value, str) and ('array' in types or 'object' in types):
        value = json.loads(value)
    if 'array' in types:
        if not isinstance(value, list) or len(value) > 1000:
            raise ValueError('Invalid tool array')
        return [normalize(x, schema.get('items', {})) for x in value]
    if 'object' in types:
        if not isinstance(value, dict) or any(k not in value for k in schema.get('required', [])):
            raise ValueError('Invalid tool object')
        return {k: normalize(value[k], s) for k,s in schema.get('properties', {}).items() if k in value}
    if value is None and 'null' in types:
        return None
    if 'string' in types and not isinstance(value, str):
        raise ValueError('Invalid tool string')
    return value


def normalize_response(response, request):
    schemas = {t.get('function', {}).get('name'): t.get('function', {}).get('parameters', {}) for t in request.get('tools', []) if isinstance(t, dict)}
    for choice in response.get('choices', []):
        for call in choice.get('message', {}).get('tool_calls', []):
            fn = call.get('function', {})
            if fn.get('name') in schemas:
                args = fn.get('arguments')
                if isinstance(args, str):
                    args = json.loads(args)
                fn['arguments'] = json.dumps(normalize(args, schemas[fn['name']]), ensure_ascii=False)
    return response
