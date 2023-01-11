import * as dotenv from 'dotenv';
dotenv.config();

import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import { AxiosError } from 'axios';
import { Configuration, OpenAIApi } from 'openai';

if (!process.env.TELEGRAM_BOT_API_KEY) {
    console.error('Please provide your bot\'s API key on the .env file.');
    process.exit();
} else if (!process.env.OPENAI_API_KEY) {
    console.error('Please provide your openAI API key on the .env file.');
    process.exit();
}


function sleep(time: number) {
    return new Promise(resolve => setTimeout(resolve, time));
}

function buildLastMessage(last_user: string, last_input: string, last_answer: string) {
    const botName = (userConfig.botName || PARAMETERS.BOT_NAME).replace('$username', last_user);
    return `${last_user}: "${last_input}"\n${botName}: "${last_answer}"\n`;
}


const token = process.env.TELEGRAM_BOT_API_KEY;
const bot = new TelegramBot(token, { polling: true });
const botUsername = (await bot.getMe()).username;

const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));

const PARAMETERS = {
    PROMPT_START: process.env.PROMPT_START || 'Conversation with $personality.',
    PERSONALITY: process.env.PERSONALITY || 'an AI',
    BOT_NAME: process.env.BOT_NAME || 'openAI',
    INPUT_SUFFIX: process.env.INPUT_SUFFIX || '$username',
    MODEL: process.env.MODEL || 'text-davinci-003',
    MAX_TOKENS: Number.parseFloat(process.env.MAX_TOKENS || '300'),
    TEMPERATURE: Number.parseFloat(process.env.TEMPERATURE || '0.5'),
    PRESENCE_PENALTY: process.env.PRESENCE_PENALTY ? Number.parseFloat(process.env.PRESENCE_PENALTY) : undefined,
    FREQUENCY_PENALTY: Number.parseFloat(process.env.FREQUENCY_PENALTY || '1'),
    CONTINUOUS_CONVERSATION: process.env.CONTINUOUS_CONVERSATION ? JSON.parse(process.env.CONTINUOUS_CONVERSATION) as boolean : false
};

let lastMessage = '';

const configJson: { personality: string, botName: string } = JSON.parse(fs.readFileSync('./user-config.json').toString());
const userConfig = {
    personality: configJson.personality,
    botName: configJson.botName
};

bot.setMyCommands([
    { command: 'personality', description: 'Define a personalidade do BOT.' },
    { command: 'name', description: 'Define o nome do BOT.' },
    { command: 'picture', description: 'Gera uma imagem.' },
    { command: 'reset', description: 'Reseta a memória do BOT.' },
]);

bot.on('message', async (msg) => {
    if (msg.text?.startsWith('/personality') || msg.text?.startsWith('/name') ||
        msg.text?.startsWith('/imagine') || msg.text?.startsWith('/reset')) {
        return;
    }

    if (msg.text && (msg.chat.type == 'private' || msg.text?.includes(`@${botUsername}`))) {
        const text = msg.text?.replace(`@${botUsername} `, '').replace(`@${botUsername}`, '');

        const suffix = PARAMETERS.INPUT_SUFFIX.replace('$username', msg.from?.username || 'user');
        const promptStart = PARAMETERS.PROMPT_START.replace('$personality', userConfig.personality || PARAMETERS.PERSONALITY);
        const botName = (userConfig.botName || PARAMETERS.BOT_NAME).replace('$username', msg.from?.username || 'username');
        const prompt = `${promptStart}\n\n${lastMessage ? lastMessage : ''}${suffix}: "${text}"\n${botName}: "`;

        console.log(prompt);

        let response: string;
        try {
            let done = false;

            (async () => {
                while (!done) {
                    await bot.sendChatAction(msg.chat.id, 'typing');
                    await sleep(5000);
                }
            })();

            const ai = (await openai.createCompletion({
                prompt,
                model: PARAMETERS.MODEL,
                temperature: PARAMETERS.TEMPERATURE,
                max_tokens: PARAMETERS.MAX_TOKENS,
                frequency_penalty: PARAMETERS.FREQUENCY_PENALTY,
                presence_penalty: PARAMETERS.PRESENCE_PENALTY,
                stop: ['"'],
            }));
            done = true;

            let price: number;
            switch (PARAMETERS.MODEL) {
            case 'text-davinci-003':
                price = 0.00002;
                break;
            case 'text-curie-001':
                price = 0.000002;
                break;
            default:
                price = 0;
                break;
            }

            response = ai.data.choices[0].text || 'error';

            console.log(`\n${suffix}: "${text}"\n${botName}: "${response}"`);
            console.log(`[usage: ${ai.data.usage?.total_tokens} tokens (R$${(ai.data.usage?.total_tokens || 0) * price * 5.17})]`);
        } catch (e) {
            if (e instanceof AxiosError) {
                console.error(e.response?.status, e.code);
            }
            return;
        }

        if (PARAMETERS.CONTINUOUS_CONVERSATION) {
            lastMessage += buildLastMessage(suffix, text, response) + '\n';
        } else {
            lastMessage = buildLastMessage(suffix, text, response);
        }

        await bot.sendMessage(msg.chat.id, response, { reply_to_message_id: msg.message_id });
    }
});

bot.onText(/\/personality (.+)/, (msg, _match) => {
    userConfig.personality = msg.text?.replace('/personality ', '') || '';
    fs.writeFileSync('user-config.json', JSON.stringify(userConfig), 'utf8');
    bot.sendMessage(msg.chat.id, `Agora sou "${userConfig.personality}"`, { reply_to_message_id: msg.message_id });
});

bot.onText(/\/name (.+)/, (msg, _match) => {
    userConfig.botName = msg.text?.replace('/name ', '') || '';
    fs.writeFileSync('user-config.json', JSON.stringify(userConfig), 'utf8');
    bot.sendMessage(msg.chat.id, `Agora me chamo "${userConfig.botName}"`, { reply_to_message_id: msg.message_id });
});

bot.onText(/\/reset/, (msg, _match) => {
    lastMessage = '';
    bot.sendMessage(msg.chat.id, 'Esqueci de tudo.', { reply_to_message_id: msg.message_id });
});

bot.onText(/\/imagine (.+)/, async (msg, match) => {
    const theme = msg.text?.replace('/imagine ', '') || '';
    let img: string;

    try {
        let done = false;

        (async () => {
            while (!done) {
                await bot.sendChatAction(msg.chat.id, 'upload_photo');
                await sleep(3000);
            }
        })();

        img = (await openai.createImage({
            prompt: theme,
            response_format: 'url'
        })).data.data[0].url || '';
        done = true;

        bot.sendPhoto(msg.chat.id, img, { reply_to_message_id: msg.message_id });
    } catch (e) {
        bot.sendMessage(msg.chat.id, 'Sua imagem não pode ser feita pois viola o sistema de segurança.', { reply_to_message_id: msg.message_id });
    }
});

console.log('Bot Started!');
