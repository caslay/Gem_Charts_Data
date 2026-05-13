import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { QUANT_SYSTEM_PROMPT } from '@/lib/aiSystemPrompt';

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured in the environment variables.');
    }

    // 1. Initialize the Google Generative AI client
    const genAI = new GoogleGenerativeAI(apiKey);

    // 2. Extract the incoming V7.9 JSON payload
    const payload = await req.json();

    // 3. Select gemini-2.5-flash for handling large JSON contexts
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // 4. Construct the final prompt by concatenating instructions and the raw data
    const prompt = `${QUANT_SYSTEM_PROMPT}\n\n=== MARKET DATA PAYLOAD ===\n${JSON.stringify(payload, null, 2)}`;

    // 5. Send the message to the Gemini model
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // 6. Return the extracted markdown text to the client
    return NextResponse.json({ analysis: text });

  } catch (error: any) {
    console.error('Quant AI Engine Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error during AI analysis.' },
      { status: 500 }
    );
  }
}
