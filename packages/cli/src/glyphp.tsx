#!/usr/bin/env node
import { render } from 'ink'
import { App } from './ui/App.js'

// `glyphp` boots the full interactive shell. The one-shot `glyph <command>`
// binary is unchanged and remains the path for scripting and CI.
render(<App />)
