module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
	// testMatch: [ '**/?(*.)+(spec|test).ts?(x)' ],
  testMatch: [ '**/backend.test.ts' ],

  testPathIgnorePatterns: [ 'node_modules', 'examples' ]
};
