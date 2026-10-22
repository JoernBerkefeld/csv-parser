import js from '@eslint/js';
import prettier from 'eslint-plugin-prettier/recommended';
import jsdoc from 'eslint-plugin-jsdoc';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';

export default [
    {
        ignores: [
            'node_modules/**',
            'coverage/**',
            '.nyc_output/**',
            'test/fixtures/**',
            'test/snapshots/**',
        ],
    },
    js.configs.recommended,
    jsdoc.configs['flat/recommended'],
    unicorn.configs.recommended,
    prettier,
    {
        languageOptions: { globals: globals.node, ecmaVersion: 2020 },
        rules: {
            'unicorn/no-asterisk-prefix-in-documentation-comments': 'off',
            'jsdoc/check-alignment': 'error',
        },
    },
    {
        files: ['test/**/*.js'],
        rules: {
            // Inherited test basenames are coupled to AVA snapshot filenames.
            'unicorn/filename-case': ['error', { cases: { camelCase: true, kebabCase: true } }],
        },
    },
    {
        files: ['**/*.js', 'bin/csv-parser', 'bin/bench'],
        languageOptions: { sourceType: 'module', ecmaVersion: 2022 },
    },
];
