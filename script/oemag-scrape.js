// Map German month names to their corresponding two-digit strings
const monthMap = {
  'januar': '01', 'jänner': '01', 'jaenner': '01',
  'februar': '02',
  'märz': '03', 'maerz': '03',
  'april': '04',
  'mai': '05',
  'juni': '06',
  'juli': '07',
  'august': '08',
  'september': '09',
  'oktober': '10',
  'november': '11',
  'dezember': '12',
}

const GIST_ID = '47cc8c26b9547e632ca099a118aa8136'
const GIST_TOKEN = process.env.GIST_TOKEN

function parseGermanFloat (str) {
  if (!str) {
    return null
  }
  const cleanStr = str.trim().replace(/\s+/g, '').replace(',', '.')
  const parsed = parseFloat(cleanStr)
  return isNaN(parsed) ? null : parsed
}

function cleanText (htmlText) {
  return htmlText
    .replace(/<\/?[^>]+(>|$)/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim()
}

async function run () {
  if (!GIST_TOKEN) {
    console.error('Missing GIST_TOKEN environment variable.')
    process.exit(1)
  }

  try {
    // 1. Fetch the existing Gist to get current contents and filename
    console.log(`Fetching current Gist data from ID: ${GIST_ID}...`)
    const gistRes = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: { 'Authorization': `Bearer ${GIST_TOKEN}` },
    })
    if (!gistRes.ok) {
      throw new Error(`Failed to fetch Gist: ${gistRes.statusText}`)
    }

    const gistData = await gistRes.json()
    // Automatically determine the first filename in the gist (e.g., austria-oemag-einspeisetarife.json)
    const fileName = Object.keys(gistData.files)[0]
    let finalResult = {}

    try {
      finalResult = JSON.parse(gistData.files[fileName].content)
      console.log(`Successfully loaded ${Object.keys(finalResult).length} existing entries from Gist.`)
    } catch (e) {
      console.log('Gist content empty or invalid JSON. Starting fresh.')
    }

    // Store a copy of the old key count to verify if changes happened
    const baselineCount = Object.keys(finalResult).length

    // 2. Fetch the target market price webpage
    const url = 'https://www.oem-ag.at/marktpreis'
    console.log(`Fetching web data from ${url}...`)
    const webRes = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    })
    if (!webRes.ok) {
      throw new Error(`HTTP error fetching page! Status: ${webRes.status}`)
    }
    const html = await webRes.text()

    // 3. Parse and append/merge new data
    const sectionRegex = /Höhe des Marktpreises\s*(\d{4})[\s\S]*?<table[\s\S]*?>([\s\S]*?)<\/table>/gi
    let match

    while ((match = sectionRegex.exec(html)) !== null) {
      const year = match[1]
      const tableContent = match[2]

      const rowRegex = /<tr[\s\S]*?>([\s\S]*?)<\/tr>/gi
      let rowMatch
      let isHeaderRow = true

      while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
        // Skip the first row containing the headers
        if (isHeaderRow) {
          isHeaderRow = false
          continue
        }

        const rowHtml = rowMatch[1]
        const cellRegex = /<td[\s\S]*?>([\s\S]*?)<\/td>/gi
        let cellMatch
        const rowCells = []

        while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
          rowCells.push(cleanText(cellMatch[1]))
        }

        if (rowCells.length >= 3) {
          const rawMonth = rowCells[0].toLowerCase()
          const rawPV = rowCells[1]
          const rawWind = rowCells[2]

          if (monthMap[rawMonth]) {
            const monthNumber = monthMap[rawMonth]
            const pvFloat = parseGermanFloat(rawPV)
            const windFloat = parseGermanFloat(rawWind)

            // Only add if not already present or if value updated
            if (pvFloat !== null) {
              finalResult[`${year}-${monthNumber}`] = pvFloat
            }
            if (windFloat !== null) {
              finalResult[`${year}-${monthNumber}-wind`] = windFloat
            }
          }
        }
      }
    }

    const updatedCount = Object.keys(finalResult).length
    console.log(`Parsing complete. Total entries now: ${updatedCount}.`)

    // Sorting the JSON keys chronologically so it remains organized
    const sortedResult = Object.keys(finalResult)
      .sort((a, b) => a.localeCompare(b))
      .reduce((obj, key) => {
        obj[key] = finalResult[key]
        return obj
      }, {})

    // 4. Update Gist ONLY if new entries were added or things changed
    const oldJsonStr = gistData.files[fileName].content.replace(/\s/g, '')
    const newJsonStr = JSON.stringify(sortedResult, null, 2).replace(/\s/g, '')

    if (oldJsonStr.trim() === newJsonStr.trim()) {
      console.log('No new data found. Gist update skipped.')
      return
    }

    console.log('New entries/changes detected! Sending update to GitHub Gist...')
    const updateRes = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${GIST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: {
          [fileName]: {
            content: newJsonStr,
          },
        },
      }),
    })

    if (updateRes.ok) {
      console.log('Gist successfully updated!')
    } else {
      throw new Error(`Failed to update Gist: ${updateRes.statusText}`)
    }

  } catch (error) {
    console.error('An error occurred during execution:', error.message)
    process.exit(1)
  }
}

run()