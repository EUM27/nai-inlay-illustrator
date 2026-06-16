# NAI-Style Inlay Illustrator for Marinara Engine

NAI-Style Inlay Illustrator is a Marinara Engine extension that installs a custom post-processing agent for inline story illustrations.

The extension does not generate images by itself. It creates a custom agent that plans chronological paragraph slots, then Marinara Engine uses your existing server-side image generation connection to create and attach the images.

## What It Does

- Installs a custom agent named `NAI-Style Inlay Illustrator`.
- Sets the agent result type to `inlay_image_plan`.
- Asks the agent to split the latest assistant response into chronological visual beats.
- Stores generated images as inlay images between matching response paragraphs.
- Uses Marinara's existing `image_generation` connection routing for the actual image request.
- Works with any supported Marinara image generation connection, not only NovelAI.

## What It Does Not Do

- It does not ask users for a NovelAI token.
- It does not store API keys in the extension.
- It does not open a floating image-generation panel.
- It does not call NovelAI directly from the browser.
- It does not automatically enable itself for every chat.

## Requirements

- A Marinara Engine build that supports custom agents with `inlay_image_plan` results.
- At least one configured `image_generation` connection in Marinara Engine.
- A normal LLM connection for the chat or for agents, because the custom agent still needs a text model to plan image slots.

## Installation

1. Open Marinara Engine.
2. Go to `Settings` -> `Extensions`.
3. Import or paste `nai-inlay-illustrator.js`.
4. Enable the extension.
5. Reload Marinara if the custom agent does not appear immediately.
6. Open the `Agents` panel.
7. Confirm that `NAI-Style Inlay Illustrator` exists under custom agents.

The extension is an installer script. When it runs, it creates or updates the custom agent through Marinara's normal `/api/agents` route.

## Chat Setup

Creating the custom agent is not enough by itself. Marinara only runs agents that are active for the current chat.

For each chat where you want inline illustrations:

1. Open the chat settings.
2. Enable agents for the chat.
3. Add `NAI-Style Inlay Illustrator` to the chat's active agent list.
4. Generate or regenerate an assistant response.

When the agent runs successfully, images are inserted between response paragraphs according to the planned slot numbers.

## Image Routing

Actual image generation uses the custom agent setting `Image Generation Connection Override`.

If that setting is empty, the installer tries to select:

1. The image generation connection marked as default for agents.
2. Otherwise, the first available `image_generation` connection.

You can change this later in the `Agents` panel. The selected connection controls which backend is used. For example, a NovelAI connection routes to NovelAI, while another configured image provider routes through that provider instead.

## Important Settings

- `Image Generation Connection Override`: the image backend Marinara uses for generated inlay images.
- `Image count range`: `1-3`, `2-5`, or `3-10`.
- `Run interval`: how often the agent should create inlay images after assistant responses.
- `Positive prompt / tags`: global image tags appended to planned prompts.
- `Negative prompt`: global negative tags sent to the image generator.
- `Connection Override`: optional LLM connection for the planning agent itself.

Image dimensions follow Marinara's existing image generation settings for the route that handles inlay images.

## Prompt Behavior

The custom agent returns JSON with this shape:

```json
{
  "shouldGenerate": true,
  "reason": "short reason",
  "images": [
    {
      "slot": 1,
      "name": "short title",
      "scene": "visible action, mood, props, and story beat",
      "place": "visible location/environment",
      "angle": "shot size, camera angle, focus, perspective",
      "positivePrompt": "scene-level image tags only",
      "negativePrompt": "scene-level negative tags only",
      "characters": [
        {
          "name": "visible character name",
          "char": "positive tags for this character",
          "neg": "negative tags for this character only"
        }
      ],
      "reason": "why this image belongs after this paragraph"
    }
  ]
}
```

`slot` means the paragraph number after which the image should be inserted.

The planner is instructed to use chronological beats and to keep scene tags, character tags, and negative tags separate. Character visuals come from Marinara's agent context, including appearance data when available.

## Security Notes

- The extension uses Marinara's same-origin API only.
- Unsafe requests include Marinara's CSRF header.
- API keys remain in Marinara connection settings on the server.
- The extension stores no provider token, secret, password, or API key.

## Troubleshooting

### The custom agent does not appear

- Make sure the extension is enabled.
- Reload Marinara after installing the extension.
- Check the browser console for extension errors.
- Confirm that your Marinara build supports custom agents and `inlay_image_plan`.

### The agent appears but no images are generated

- Make sure agents are enabled for the current chat.
- Add `NAI-Style Inlay Illustrator` to the chat's active agent list.
- Set an `Image Generation Connection Override`, or mark an image generation connection as default for agents.
- Check the chat for agent error messages such as missing image generation connection.

### The wrong backend is used

Open the custom agent settings and change `Image Generation Connection Override` to the desired `image_generation` connection.

### Images appear at the wrong place

The agent inserts images by paragraph slot. If the model returns bad slot numbers, reduce the image count range or edit the custom agent prompt to be stricter about paragraph order.

## Uninstall

To remove it completely:

1. Delete the `nai-inlay-illustrator` extension from `Settings` -> `Extensions`.
2. Delete the `NAI-Style Inlay Illustrator` custom agent from the `Agents` panel.
3. Remove it from any chat active-agent lists if it remains referenced there.

Already generated gallery images and message inlays are not deleted automatically.
