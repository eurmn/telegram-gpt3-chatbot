# GPT-3 Chatbot for Telegram
A Telegram Chatbot powered by OpenAI's GPT-3 completion.

![screenshot example](screenshot.png)

## Usage:
  - Clone the repo:
    ```
    git clone https://github.com/euromoon/telegram-chatbot.git
    ```
  - Install the dependencies:
    ```
    npm install
    ```
  - Set your Telegram bot API key, OpenAI API key and any other setting you might want to change in the `.env` file. Then, run the script:
    ```
    npm run start
    ```

## Configuration and Tips:
User configuration is stored at the .env file. The project comes with a default .env.example file explaining what each variable does.

The `name` and `personality` variables have a priority for values defined by the user using the `/name` and `/personality` commands.

The script automatically creates a `history.jsonl` file with all the prompts and completions. This file can be used later to [fine-tune the model](https://beta.openai.com/docs/guides/fine-tuning).