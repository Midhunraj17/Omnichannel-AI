import dotenv from 'dotenv';

dotenv.config();


const requiredVariables = [
    'PORT',
    'AI_SERVICE_URL',
    'AI_SERVICE_API_KEY'
];


for (const variable of requiredVariables) {

    if (!process.env[variable]) {

        throw new Error(
            `Missing environment variable: ${variable}`
        );

    }

}


export const env = {

    port: Number(process.env.PORT),

    nodeEnv: process.env.NODE_ENV || 'development',

    frontendUrl: process.env.FRONTEND_URL,

    aiServiceUrl: process.env.AI_SERVICE_URL,

    databaseUrl: process.env.DATABASE_URL,

    supabaseUrl: process.env.SUPABASE_URL,

    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,

    aiServiceApiKey: process.env.AI_SERVICE_API_KEY

};