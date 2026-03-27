const path = require('path')
const nextJest = require('next/jest')

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    // Must precede ^@/(.*)$ so Jest does not resolve to the real cel-evaluator (cel-js).
    '^@/lib/rbac/cel-evaluator$': path.resolve(__dirname, 'src/lib/rbac/cel-evaluator.jest.ts'),
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.{js,jsx,ts,tsx}',
    '!src/**/__tests__/**',
  ],
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.{js,jsx,ts,tsx}',
    '<rootDir>/src/**/*.{spec,test}.{js,jsx,ts,tsx}',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(uuid|@a2a-js|jose)/)',
  ],
  // Prevent CI failure when workers do not exit gracefully (e.g. SkillsBuilderEditor async state)
  forceExit: true,
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
// We override the resolved config to ensure our transformIgnorePatterns take effect
// (next/jest prepends its own patterns that can shadow ours)
const baseConfig = createJestConfig(customJestConfig)
module.exports = async () => {
  const config = await baseConfig()
  // Replace next/jest's transformIgnorePatterns with ours so ESM packages (jose, uuid, etc.) are transformed
  config.transformIgnorePatterns = [
    'node_modules/(?!(uuid|@a2a-js|jose|cel-js|chevrotain|lodash-es)/)',
    '^.+\\.module\\.(css|sass|scss)$',
  ]
  config.moduleNameMapper = {
    '^cel-js$': path.resolve(__dirname, 'src/__mocks__/cel-js.ts'),
    '^@/lib/rbac/cel-evaluator$': path.resolve(__dirname, 'src/lib/rbac/cel-evaluator.jest.ts'),
    ...config.moduleNameMapper,
  }
  return config
}
