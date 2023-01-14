import * as dotenv from 'dotenv';
dotenv.config();

import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import { Configuration, OpenAIApi } from 'openai';

if (!process.env.TELEGRAM_BOT_API_KEY) {
    console.error('Please provide your bot\'s API key on the .env file.');
    process.exit();
} else if (!process.env.OPENAI_API_KEY) {
    console.error('Please provide your openAI API key on the .env file.');
    process.exit();
}

/** A simple async sleep function.
 * @example
 * await sleep(2000);
 * console.log('Two seconds have passed.');
 */
function sleep(time: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, time));
}

/** Escapes a string for it to be used in a markdown message.
 * @param {string} input - The input message.
 * @returns {string} The escaped message.
 */
function escapeForMarkdown(input: string): string {
    return input.replace('_', '\\_')
        .replace('*', '\\*')
        .replace('[', '\\[')
        .replace('`', '\\`')
        .replace('.', '\\.');
}

/** Formats the data about a message to be used later as a history for the AI in case
 * CONTINUOUS_CONVERSATION is `true`.
 * @param {string} lastUser - The username.
 * @param {string} lastInput - The message.
 * @param {string} lastAnswer - The AI's completion.
 * @returns {string} The formatted message.
 */
function buildLastMessage(lastUser: string, lastInput: string, lastAnswer: string): string {
    return formatVariables(`${lastUser}: ###${lastInput}###\n$name: ###${lastAnswer}###\n`);
}

/** Replace `$placeholders` for the actual values of the variables.
 * @example formatVariables("Hello, $username.", { username: "john" }) // "Hello, john."
 * @param {string} input - The unformatted string.
 * @param {{ username?: string, command?: string }} optionalParameters -
 * The `username` or the `command` variables.
 * @returns {string} The formatted string.
 */
function formatVariables(input: string, optionalParameters?: {
    username?: string, command?: string
}): string {
    return input.replace('$personality', userConfig.personality || PARAMETERS.PERSONALITY)
        .replace('$name', userConfig.botName || PARAMETERS.BOT_NAME)
        .replace('$username', optionalParameters?.username || 'username')
        .replace('$command', optionalParameters?.command || 'command');
}

/** Removes the name of the command from the command's message.
 * @param {string} input - The raw message.
 * @returns {string} The message without the `/command`.
*/
function removeCommandNameFromCommand(input: string): string {
    const ar = input.split(' ');
    ar.shift();
    return ar.join(' ');
}

/** Switches the bot's personality sent at the beggining of the prompt for OpenAI's completion.
 * @param {string} personality - The bot's new personality.
*/
function switchPersonality(personality: string) {
    userConfig.personality = personality;
    fs.writeFileSync('user-config.json', JSON.stringify(userConfig), 'utf8');
}

/** Switches the bot's name sent to OpenAI for completion.
 * @param {string} name - The bot's new name.
 */
function switchBotName(name: string) {
    userConfig.botName = name;
    fs.writeFileSync('user-config.json', JSON.stringify(userConfig), 'utf8');
}

/** Switches bot's language for pre-generated messages
 * @param {'en' | 'pt' | string} language - The language the bot will now speak.
 */
function switchLanguage(language: 'en' | 'pt' | string) {
    userConfig.language = language;
    fs.writeFileSync('user-config.json', JSON.stringify(userConfig), 'utf8');
}

/** Resets the bot's memory about previous messages. */
function resetBotMemory() {
    lastMessage = '';
}

/** Generates a picture using DALL·E 2.
 * @param {string} input - The prompt for the picture.
 * @returns {Promise<string>} The URL of the generated image.
*/
async function generatePicture(input: string): Promise<string> {
    return new Promise((resolve, reject) => {
        openai.createImage({
            prompt: input,
            response_format: 'url'
        }).then(data => {
            resolve(data.data.data[0].url || '');
        }).catch((e) => reject(e));
    });
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
    PRESENCE_PENALTY: process.env.PRESENCE_PENALTY ?
        Number.parseFloat(process.env.PRESENCE_PENALTY) : undefined,
    FREQUENCY_PENALTY: Number.parseFloat(process.env.FREQUENCY_PENALTY || '1'),
    CONTINUOUS_CONVERSATION: process.env.CONTINUOUS_CONVERSATION ?
        JSON.parse(process.env.CONTINUOUS_CONVERSATION) as boolean : true,
    LANGUAGE: process.env.LANGUAGE || 'en'
};

const MODEL_PRICES: {
    [key:
        'text-davinci-003' | 'text-curie-001' |
        'text-babbage-001' | 'text-ada-001' |
        'code-davinci-002' | 'code-cushman-001' | string
    ]: number
} = {
    'text-davinci-003': .00002,
    'text-curie-001': .000002,
    'text-babbage-001': .0000005,
    'text-ada-001': 0.0000004,
};

let lastMessage = '';

let userConfig: { personality: string, botName: string, language: string } ;
if (fs.existsSync('./user-config.json')) {
    userConfig = JSON.parse(fs.readFileSync('./user-config.json').toString());
} else {
    userConfig = {
        personality: '',
        botName: '',
        language: ''
    };
}

const TRANSLATIONS: {
    [key: 'en' | 'pt' | string]: {
        general: {
            'personality-switch': string,
            'name-switch': string,
            'default-start': string,
            'default-personality': string,
            'memory-reset': string,
            'language-switch': string,
            'start-message': string
        },
        'command-descriptions': {
            personality: string,
            name: string,
            reset: string,
            imagine: string,
            language: string,
            start: string
        }
        errors: {
            'generic-error': string,
            'image-safety': string,
            'no-parameter-command': string,
            'invalid-language': string
        }
    }
} = JSON.parse(fs.readFileSync('./translations.json').toString());

bot.setMyCommands([
    {
        command: 'start',
        description: TRANSLATIONS[userConfig.language || PARAMETERS.LANGUAGE][
            'command-descriptions'].start
    },
    {
        command: 'personality',
        description: TRANSLATIONS[userConfig.language || PARAMETERS.LANGUAGE][
            'command-descriptions'].personality
    },
    {
        command: 'name',
        description: TRANSLATIONS[userConfig.language || PARAMETERS.LANGUAGE][
            'command-descriptions'].name
    },
    {
        command: 'imagine',
        description: TRANSLATIONS[userConfig.language || PARAMETERS.LANGUAGE][
            'command-descriptions'].imagine
    },
    {
        command: 'reset',
        description: TRANSLATIONS[userConfig.language || PARAMETERS.LANGUAGE][
            'command-descriptions'].reset
    },
    {
        command: 'language',
        description: TRANSLATIONS[userConfig.language || PARAMETERS.LANGUAGE][
            'command-descriptions'].language
    },
]);

// Messages for conversations.
bot.on('message', async (msg) => {
    for (const command of (await bot.getMyCommands())) {
        if (msg.text?.startsWith('/' + command.command)) return;
    }

    if (msg.text && (msg.chat.type == 'private' || msg.text?.includes(`@${botUsername}`))) {
        const text = msg.text?.replace('@' + botUsername + ' ', '')
            .replace('@' + botUsername, '').replace('#', '\\#');
        const username = msg.from?.username || 'user';

        const suffix = formatVariables(PARAMETERS.INPUT_SUFFIX, { username });
        const promptStart = formatVariables(PARAMETERS.PROMPT_START, { username });
        const botName = formatVariables(userConfig.botName || PARAMETERS.BOT_NAME, { username });
        const prompt = promptStart + '\n\n' + (lastMessage ? lastMessage : '') +
            suffix + ': ###' + text + '###\n' + botName + ': ###';

        let response: string;
        try {
            let done = false;

            (async () => {
                while (!done) {
                    await bot.sendChatAction(msg.chat.id, 'typing');
                    await sleep(3000);
                }
            })();

            const ai = (await openai.createCompletion({
                prompt,
                model: PARAMETERS.MODEL,
                temperature: PARAMETERS.TEMPERATURE,
                max_tokens: PARAMETERS.MAX_TOKENS,
                frequency_penalty: PARAMETERS.FREQUENCY_PENALTY,
                presence_penalty: PARAMETERS.PRESENCE_PENALTY,
                stop: ['###'],
            }));
            done = true;

            const price = MODEL_PRICES[PARAMETERS.MODEL] || 0;

            response = ai.data.choices[0].text || 'error';

            console.log(`\n${suffix}: "${text}"\n${botName}: "${response}"`);
            console.log(
                `[usage: ${ai.data.usage?.total_tokens || -1} tokens ` +
                `($${(ai.data.usage?.total_tokens || 0) * price})]`
            );

            if (PARAMETERS.CONTINUOUS_CONVERSATION) {
                lastMessage += buildLastMessage(suffix, text, response) + '\n';
                fs.appendFileSync(
                    'history.jsonl',
                    JSON.stringify({
                        prompt: `${suffix}: ###${text}###\n${botName}: ###`,
                        completion: response
                    }) + '\n');
            } else {
                lastMessage = buildLastMessage(suffix, text, response);
            }

            await bot.sendMessage(msg.chat.id, response, {
                reply_to_message_id: msg.message_id,
            });
        } catch (e) {
            await bot.sendMessage(
                msg.chat.id,
                TRANSLATIONS[userConfig.language || PARAMETERS.LANGUAGE].errors['generic-error'],
                { reply_to_message_id: msg.message_id }
            );
            console.error(e);
            return;
        }
    }
});

bot.onText(/^\/(\w+)(@\w+)?(?:\s.\*)?/ , async (msg, match) => {
    if (!match) return;

    let command: string | undefined;

    if (match.input.split(' ').length != 1) {
        command = match.input.split(' ').shift();
    } else {
        command = match.input;
        if (!(command.startsWith('/reset') || command.startsWith('/start'))) {
            await bot.sendMessage(
                msg.chat.id,
                formatVariables(
                    TRANSLATIONS[userConfig.language || PARAMETERS.LANGUAGE]
                        .errors['no-parameter-command'],
                    { command }
                ),
                { reply_to_message_id: msg.message_id }
            );
            return;
        }
    }

    if (command?.endsWith('@' + botUsername)) {
        command = command.replace('@' + botUsername, '');
    } else if (msg.chat.type != 'private') {
        return;
    }

    const input = removeCommandNameFromCommand(match.input);

    let done = false;
    switch (command) {
    case '/start':
        await bot.sendMessage(
            msg.chat.id,
            formatVariables(
                TRANSLATIONS[userConfig.language || PARAMETERS.LANGUAGE]
                    .general['start-message']
            ),
            { reply_to_message_id: msg.message_id }
        );
        break;
    case '/personality':
        switchPersonality(input);
        await bot.sendMessage(
            msg.chat.id,
            formatVariables(
                TRANSLATIONS[userConfig.language || PARAMETERS.LANGUAGE]
                    .general['personality-switch']
            ),
            { reply_to_message_id: msg.message_id }
        );
        break;
    case '/name':
        switchBotName(input);
        await bot.sendMessage(
            msg.chat.id,
            formatVariables(
                TRANSLATIONS[userConfig.language || PARAMETERS.LANGUAGE].general['name-switch']
            ),
            { reply_to_message_id: msg.message_id }
        );
        break;
    case '/reset':
        resetBotMemory();
        await bot.sendMessage(
            msg.chat.id,
            TRANSLATIONS[userConfig.language || PARAMETERS.LANGUAGE].general['memory-reset'],
            { reply_to_message_id: msg.message_id }
        );
        break;
    case '/language':
        if (Object.keys(TRANSLATIONS).includes(input)) {
            switchLanguage(input);
            await bot.sendMessage(
                msg.chat.id,
                TRANSLATIONS[input].general['language-switch'],
                { reply_to_message_id: msg.message_id }
            );
            break;
        }

        await bot.sendMessage(
            msg.chat.id,
            TRANSLATIONS[userConfig.language || PARAMETERS.LANGUAGE]
                .errors['invalid-language'].replace('$language', input),
            { reply_to_message_id: msg.message_id }
        );
        break;
    case '/imagine':
        (async () => {
            while (!done) {
                await bot.sendChatAction(msg.chat.id, 'upload_photo');
                await sleep(3000);
            }
        })();

        try {
            const imageUrl = await generatePicture(input);
            await bot.sendPhoto(msg.chat.id, imageUrl, { reply_to_message_id: msg.message_id });
            done = true;
        } catch (e) {
            await bot.sendMessage(
                msg.chat.id,
                TRANSLATIONS[userConfig.language || PARAMETERS.LANGUAGE].errors['image-safety'],
                { reply_to_message_id: msg.message_id}
            );
            done = true;
        }
        break;
    default:
        break;
    }
});

console.log('Bot Started!');

process.on('SIGINT', () => {
    console.log('\nExiting...');
    bot.stopPolling();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nExiting...');
    bot.stopPolling();
    process.exit(0);
});