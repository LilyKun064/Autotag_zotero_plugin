# Autotag for Zotero

Autotag automatically generates tags for your Zotero items using an AI model.
You select the items → Autotag analyzes their metadata → useful tags are added to each item.

The cat icon you’ll see in the menu is my black cat *Jesse*, who contributed to this project by *enthusiastically* stepping on the keyboard during development.

## How to Install

1. Download the .xpi file from the Releases page.

2. In Zotero, go to Tools → Add-ons.

3. Click the gear icon → Install Add-on from File…

4. Choose the downloaded .xpi

5. Restart Zotero.

## Setting Up

Before using Autotag, you must enter your API key.

1. Open Zotero.

2. Go to Tools → Autotag: settings…

3. Paste your API key (OpenAI or compatible).

4. Click Save.

## Using Autotag

1. Select one or more items in your Zotero library.

2. Go to Tools → Autotag: tag selected items.

3. Autotag will analyze the items and automatically add tags.

That’s it — the tags will appear directly on your items. Sometimes it might take longer depending on how many papers you selected. Be patient. 

Once the auto-tagging process is done, a window will pop up to show you tags selected for each paper. You can verify/add/delete/edit tags as you want before adding them to your item. 

## What Autotag Uses

Autotag sends only item metadata such as:

- title

- abstract

- authors

- publication

- date

- PDFs or full text are not uploaded.

## Support

If something doesn’t work or you have ideas for improvement, please open an issue on GitHub.

## Acknowledgments

This Zotero plugin is built using the excellent [Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template) created by **windingwind**.  
Their work provided the foundation and build system that made this plugin possible.  
Huge thanks to them for maintaining such a well-structured and developer-friendly template.
