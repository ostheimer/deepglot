# Deepglot WordPress Plugin

This directory contains the first MVP scaffold for the Deepglot WordPress plugin.

## Author

Andreas Ostheimer  
https://www.ostheimer.at

## Included in this iteration

- Plugin bootstrap with the WordPress header
- Simple PSR-4-style autoloader
- Lightweight service container
- Admin page under `Settings -> Deepglot`
- Configurable API client for the Deepglot API
- First frontend integration via output buffering
- Testable URL language logic for language prefixes such as `/en/about/`

## Directory structure

```text
wordpress-plugin/deepglot/
├── deepglot.php
├── bootstrap.php
├── includes/
│   ├── Admin/
│   ├── Api/
│   ├── Config/
│   ├── Frontend/
│   └── Support/
└── tests/
```

## Installation in WordPress

1. Package the `wordpress-plugin/deepglot` directory as a ZIP archive.
2. Upload it in WordPress under `Plugins -> Add New -> Upload Plugin`.
3. Activate the plugin.
4. Under `Settings -> Deepglot`, configure the API base URL, API key, and languages.

## Current scope

This iteration is intentionally a scaffold:

- The admin configuration is already usable.
- The API client is prepared and can be connected directly to `POST /api/translate`.
- The frontend already starts output buffering when a target language is active.
- The actual HTML extraction, translation, cache table, and link replacement follow in the next steps.

## Test

If PHP is available locally:

```bash
php wordpress-plugin/deepglot/tests/UrlLanguageResolverTest.php
```

## Next plugin steps

1. Integrate request URL and language detection directly into the frontend flow.
2. Connect the HTML parser and string extraction.
3. Use the API client for real translation requests.
4. Add the local WordPress cache and link replacement.
