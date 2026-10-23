import unittest
from tool_adapter import prepare_request, normalize_response, normalize


class ToolAdapterTests(unittest.TestCase):
    def test_schema_injection_does_not_mutate_original(self):
        request = {'messages': [{'role': 'user', 'content': 'sample'}], 'tools': [{'function': {'name': 'report', 'parameters': {'type': 'object'}}}], 'tool_choice': {'function': {'name': 'report'}}}
        prepared = prepare_request(request)
        self.assertEqual(len(request['messages']), 1)
        self.assertIn('report', prepared['messages'][0]['content'])

    def test_nested_stringified_arrays_are_typed_and_validated(self):
        schema = {'type': 'object', 'properties': {'items': {'type': 'array', 'items': {'type': 'string'}}}, 'required': ['items']}
        self.assertEqual(normalize({'items': '["one", "two"]'}, schema), {'items': ['one', 'two']})
        for value in ({}, {'items': 'bad'}, {'items': [1]}):
            with self.assertRaises((ValueError, TypeError)):
                normalize(value, schema)
        self.assertIsNone(normalize('null', {'type': ['array', 'null']}))


if __name__ == '__main__':
    unittest.main()
