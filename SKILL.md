---
name: browser-use
description: Browser automation skill for AI agents using the browser-use Python library. Use this skill when asked to automate web tasks, scrape data, fill forms, interact with websites, or run browser-based workflows with an AI agent.
license: MIT
metadata:
  author: browser-use
  version: "1.0.0"
  homepage: https://browser-use.com
  docs: https://docs.browser-use.com
---

# Browser Use

[browser-use](https://github.com/browser-use/browser-use) makes websites accessible for AI agents. Use it to automate any browser task — searching, form filling, data extraction, multi-tab workflows, and more.

## When to Use

Use this skill when:
- Automating web tasks (searches, form fills, data collection)
- Scraping or extracting structured data from websites
- Running multi-step browser workflows
- Logging into services and performing actions
- Testing web UIs programmatically

## Installation

```bash
uv add browser-use
# Install Chromium if not already present:
uvx browser-use install
```

Or with pip:
```bash
pip install browser-use
playwright install chromium
```

## Quick Start

### With Browser Use Cloud (recommended — no setup needed)

Get a free API key at [cloud.browser-use.com](https://cloud.browser-use.com/new-api-key).

```python
import os
from browser_use import Agent, ChatBrowserUse

agent = Agent(
    task="Find the number of GitHub stars for the browser-use repo",
    llm=ChatBrowserUse(model="bu-2-0"),
)
agent.run_sync()
```

Set the environment variable:
```
BROWSER_USE_API_KEY=your-key
```

### With Claude (Anthropic)

```python
import asyncio
from dotenv import load_dotenv
from browser_use import Agent, ChatAnthropic

load_dotenv()  # expects ANTHROPIC_API_KEY in .env

async def main():
    agent = Agent(
        task="Go to github.com/browser-use/browser-use and get the repo description",
        llm=ChatAnthropic(model="claude-sonnet-4-6"),
    )
    history = await agent.run()
    print(history.final_result())

asyncio.run(main())
```

## Core Concepts

### Agent Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `task` | `str` | Natural language description of what to do |
| `llm` | LLM instance | The language model to drive the agent |
| `browser` | `Browser` (optional) | Browser instance (auto-created if omitted) |
| `browser_session` | `BrowserSession` (optional) | Reuse an existing browser session |
| `sensitive_data` | `dict` (optional) | Credentials to pass without exposing to LLM |
| `extend_system_message` | `str` (optional) | Append extra instructions to the system prompt |
| `override_system_message` | `str` (optional) | Fully replace the system prompt |
| `output_model_schema` | Pydantic model (optional) | Force structured output |
| `max_steps` | `int` (optional) | Limit agent steps (default: 100) |

### Browser & Session Configuration

```python
from browser_use.browser import BrowserProfile, BrowserSession

session = BrowserSession(
    browser_profile=BrowserProfile(
        headless=True,              # Run without visible browser window
        keep_alive=True,            # Keep browser open between runs
        user_data_dir="~/.config/browseruse/profiles/default",  # Persist cookies/logins
    )
)

agent = Agent(task="...", llm=llm, browser_session=session)
await session.start()
await agent.run()
await session.kill()
```

## Common Patterns

### Structured Output

Extract structured data with a Pydantic model:

```python
import asyncio
from pydantic import BaseModel
from browser_use import Agent, ChatAnthropic

class SearchResult(BaseModel):
    title: str
    url: str
    snippet: str

class SearchResults(BaseModel):
    results: list[SearchResult]

async def main():
    agent = Agent(
        task="Search Google for 'browser-use python' and return the top 5 results",
        llm=ChatAnthropic(model="claude-sonnet-4-6"),
        output_model_schema=SearchResults,
    )
    history = await agent.run()
    raw = history.final_result()
    if raw:
        data = SearchResults.model_validate_json(raw)
        for r in data.results:
            print(r.title, r.url)

asyncio.run(main())
```

### Secure Credentials

Pass sensitive values without exposing them to the LLM:

```python
from browser_use import Agent, ChatAnthropic

sensitive_data = {
    "github.com": {
        "gh_username": "my_actual_username",
        "gh_password": "my_actual_password",
    }
}

agent = Agent(
    task="Log into GitHub as gh_username using gh_password and star the browser-use repo",
    llm=ChatAnthropic(model="claude-sonnet-4-6"),
    sensitive_data=sensitive_data,
)
agent.run_sync()
```

The LLM sees placeholder names (`gh_username`, `gh_password`); the real values are injected only when actually typed into the browser.

### Parallel Agents

Run multiple agents concurrently in a shared browser session:

```python
import asyncio
from browser_use import Agent, ChatAnthropic
from browser_use.browser import BrowserProfile, BrowserSession

async def main():
    session = BrowserSession(
        browser_profile=BrowserProfile(keep_alive=True, headless=True)
    )
    await session.start()

    llm = ChatAnthropic(model="claude-haiku-4-5")
    tasks = [
        "Find the current BTC price on coinbase.com",
        "Get the top headline from news.ycombinator.com",
        "Check the weather in Tokyo on weather.com",
    ]
    agents = [Agent(task=t, llm=llm, browser_session=session) for t in tasks]
    results = await asyncio.gather(*[a.run() for a in agents])
    for r in results:
        print(r.final_result())

    await session.kill()

asyncio.run(main())
```

### Follow-up Tasks

Reuse agent state for a multi-turn workflow:

```python
import asyncio
from browser_use import Agent, ChatAnthropic

async def main():
    llm = ChatAnthropic(model="claude-sonnet-4-6")
    agent = Agent(task="Go to github.com/browser-use/browser-use", llm=llm)
    await agent.run()

    agent.add_new_task("Now click the Issues tab and return the title of the first open issue")
    history = await agent.run()
    print(history.final_result())

asyncio.run(main())
```

### Custom System Prompt

```python
from browser_use import Agent, ChatAnthropic

agent = Agent(
    task="Search for the latest AI news",
    llm=ChatAnthropic(model="claude-sonnet-4-6"),
    extend_system_message="Always summarize results in bullet points. Prefer .edu and .gov sources.",
)
agent.run_sync()
```

## Available LLM Wrappers

| Import | Model Examples |
|--------|---------------|
| `ChatBrowserUse` | `bu-2-0` (cloud, recommended) |
| `ChatAnthropic` | `claude-sonnet-4-6`, `claude-haiku-4-5-20251001` |
| `ChatOpenAI` | `gpt-4.1`, `gpt-4.1-mini` |
| `ChatGoogle` | `gemini-3-flash-preview` |

All are drop-in compatible — just swap the `llm=` argument.

## Best Practices

- **Use `headless=True`** in CI or automated pipelines to skip the visible browser.
- **Persist user profiles** (`user_data_dir`) to avoid re-logging in on every run.
- **Use `sensitive_data`** for any credentials — never put real passwords in the task string.
- **Use structured output** (`output_model_schema`) when you need machine-readable results.
- **Set `max_steps`** to prevent runaway agents on complex or ambiguous tasks.
- **Use `ChatBrowserUse`** for best results out of the box — it's a model fine-tuned specifically for browser tasks.
- For long tasks, monitor progress via `agent.run(on_step_done=callback)`.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `BROWSER_USE_API_KEY` | Required for `ChatBrowserUse` cloud model |
| `ANTHROPIC_API_KEY` | Required for `ChatAnthropic` |
| `OPENAI_API_KEY` | Required for `ChatOpenAI` |
| `GOOGLE_API_KEY` | Required for `ChatGoogle` |

## More Resources

- [Documentation](https://docs.browser-use.com)
- [GitHub](https://github.com/browser-use/browser-use)
- [Cloud Platform](https://cloud.browser-use.com)
- [Discord Community](https://link.browser-use.com/discord)
