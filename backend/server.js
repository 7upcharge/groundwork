const { createApp } = require('./app');
const config = require('./config');

const { app, llm } = createApp();

app.listen(config.port, () => {
  console.log(`Groundwork listening on http://localhost:${config.port}`);
  console.log(`Model: ${llm ? `${llm.name}:${llm.model}` : 'none (offline engine only)'}`);
});
