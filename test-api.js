import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function listModels() {
  try {
    console.log('Listing available models...\n');
    
    // Try to list models (this endpoint might work even if generateContent doesn't)
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`
    );
    
    if (!response.ok) {
      console.error('❌ API request failed:', response.status, response.statusText);
      console.error('Your API key might be invalid or expired.');
      console.error('\nGet a new key at: https://aistudio.google.com/apikey');
      return;
    }
    
    const data = await response.json();
    
    if (data.models && data.models.length > 0) {
      console.log('✅ Available models:');
      data.models.forEach(model => {
        if (model.supportedGenerationMethods?.includes('generateContent')) {
          console.log(`  - ${model.name}`);
        }
      });
    } else {
      console.log('No models found.');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\nMake sure your API key is correct in .env file');
    console.error('Get a new key at: https://aistudio.google.com/apikey');
  }
}

listModels();
