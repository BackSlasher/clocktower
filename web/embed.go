// Package web embeds the static frontend (TV and phone pages, shared files).
package web

import "embed"

// FS holds every file under web/ (served from disk instead with -dev).
//
//go:embed *
var FS embed.FS
