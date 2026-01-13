# Browser Tools

Headless Chromium via `browser-tool` CLI. Works from any directory.

## Quick Start

```bash
# Navigate to your app
browser-tool navigate http://localhost:3000

# Take a screenshot
browser-tool screenshot

# Check for errors
browser-tool errors
browser-tool console
```

## Commands

### browser-tool navigate \<url\>
Open a URL, returns page title and HTTP status.
```bash
browser-tool navigate http://localhost:3000
# {"success":true,"url":"http://localhost:3000/","title":"My App","status":200}
```

### browser-tool screenshot [options]
Capture the page as PNG.
```bash
browser-tool screenshot                          # Viewport
browser-tool screenshot --full-page              # Full scrollable page
browser-tool screenshot --selector "#hero"       # Specific element
browser-tool screenshot --output /tmp/test.png   # Custom path
```
Screenshots saved to `/workspace/.browser-screenshots/` by default.

### browser-tool click \<selector\>
Click an element.
```bash
browser-tool click "button.submit"
browser-tool click "#login-btn"
browser-tool click "a[href='/about']"
```

### browser-tool type \<selector\> \<text\>
Type into an input field.
```bash
browser-tool type "#email" "user@example.com"
browser-tool type "input[name='search']" "query"
```

### browser-tool evaluate \<javascript\>
Run JavaScript in page context.
```bash
browser-tool evaluate "document.title"
browser-tool evaluate "document.querySelectorAll('a').length"
browser-tool evaluate "localStorage.getItem('token')"
```

### browser-tool content [selector]
Get text/HTML content.
```bash
browser-tool content                    # Full page info
browser-tool content "#main"            # Specific element
browser-tool content ".error-message"
```

### browser-tool console
Get recent console logs (last 20).
```bash
browser-tool console
# {"success":true,"count":5,"logs":[{"type":"log","text":"App loaded",...}]}
```

### browser-tool errors
Get recent JavaScript errors (last 10).
```bash
browser-tool errors
# {"success":true,"count":1,"errors":[{"message":"Uncaught TypeError:...",...}]}
```

### browser-tool close
Close the browser and clear state.
```bash
browser-tool close
```

## Example Workflow

```bash
# Start your dev server (in another tmux window)
npm run dev &

# Wait for it
sleep 3

# Navigate and check
browser-tool navigate http://localhost:3000
browser-tool screenshot

# Interact
browser-tool click "#login-btn"
browser-tool type "#email" "test@test.com"
browser-tool type "#password" "password123"
browser-tool click "button[type='submit']"

# Check results
browser-tool screenshot
browser-tool errors
browser-tool console

# Done
browser-tool close
```

## Output Format

All commands return JSON:
```json
{
  "success": true,
  "url": "http://localhost:3000",
  "title": "My App",
  ...
}
```

On error:
```json
{
  "success": false,
  "error": "Element not found: #missing"
}
```

## Selectors Reference

| Type | Example |
|------|---------|
| ID | `#submit-btn` |
| Class | `.card` |
| Tag | `button` |
| Attribute | `input[type="email"]` |
| Text | `text=Submit` |
| Combination | `form.login button.primary` |

## Tips

- Browser stays open between commands for speed
- Use `browser-tool close` when done to free resources
- Screenshots are in `/workspace/.browser-screenshots/`
- Console/error logs persist across commands (last 100/50)
