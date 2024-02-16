import type {JestConfigWithTsJest} from 'ts-jest'

const config: JestConfigWithTsJest = {
  // Automatically clear mock calls, instances, contexts and results before every test
  clearMocks: true,

  // Indicates whether the coverage information should be collected while executing the test
  collectCoverage: false,

  // The directory where Jest should output its coverage files
  coverageDirectory: 'coverage',

  // Indicates which provider should be used to instrument code for coverage
  coverageProvider: 'v8',

  // A list of paths to directories that Jest should use to search for files in
  roots: ['<rootDir>/__tests__'],
  setupFiles: ['<rootDir>/__tests__/utils/jestSetup.ts'],
  testPathIgnorePatterns: ['env', 'utils'],
  // testTimeout: 30000,
  verbose: true,
  transform: {
    '^.+\\.[jt]sx?$': ['ts-jest', {
      tsconfig: '__tests__/tsconfig.json'
    }],
  },
  moduleNameMapper: {
    "(.+)\\.js": "$1"
  },
  extensionsToTreatAsEsm: [".ts"],
}

export default config
