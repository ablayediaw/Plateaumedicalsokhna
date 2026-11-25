const path = require('path');
const { createApp } = require('../server');

const app = createApp({
  rootDir: path.resolve(__dirname, '..'),
});

module.exports = app;
