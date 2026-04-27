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
  // Transform ESM packages
  transformIgnorePatterns: [
    'node_modules/(?!(uuid|@a2a-js|jose|marked|marked-shiki|morphdom|shiki|remend|dompurify|@shikijs|bson|mongodb)/)',
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
    'node_modules/(?!(uuid|@a2a-js|jose|marked|marked-shiki|morphdom|shiki|remend|dompurify|@shikijs|bson|mongodb)/)',
    '^.+\\.module\\.(css|sass|scss)$',
  ]
  return config
}
