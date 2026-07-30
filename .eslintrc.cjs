module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: [
    'dist',
    'node_modules',
    'src/context/SalaryContext.jsx',
    'src/pages/Employees.jsx',
    'src/pages/Inbox.jsx',
    'src/pages/Performance.jsx',
    'src/pages/Reports.jsx',
    'src/pages/Salary.jsx',
  ],
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['react-refresh'],
  rules: {
    'no-unused-vars': ['error', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^(React|_)',
    }],
    'react/prop-types': 'off',
    'react-hooks/exhaustive-deps': 'off',
    'react-refresh/only-export-components': 'off',
  },
  settings: {
    react: {
      version: '18.2',
    },
  },
};
