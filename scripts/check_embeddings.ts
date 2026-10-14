import {createEmbedder} from '../server/embeddings.js';
import {EMBEDDING_MODEL,EMBEDDING_DIMENSIONS,requireEmbeddingConfig} from '../server/config.js';

try{
  const config=requireEmbeddingConfig();
  const vectors=await createEmbedder(config.embeddingApiKey).embed(['Austra offers vocational courses.','Course fees and intake dates.'],'passage');
  console.log(JSON.stringify({model:EMBEDDING_MODEL,dimensions:EMBEDDING_DIMENSIONS,vectors:vectors.length,embedding_connected:true},null,2));
}catch{
  console.error('Embedding check failed. For Ollama, start the service and pull the configured model. For cloud providers, verify their separate key and quota.');
  process.exitCode=1;
}
