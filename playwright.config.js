module.exports={testDir:'./tests',testMatch:'*.spec.js',workers:3,reporter:'list',use:{channel:process.env.CI?'chromium':'chrome'},timeout:150000};
