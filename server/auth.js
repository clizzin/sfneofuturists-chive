'use strict'

const path = require('path')

const inflight = require('promise-inflight')
const {google} = require('googleapis')
const {auth: nodeAuth} = require('google-auth-library')

const log = require('./logger')

let authClient = null

// Look for google application credentials as json env var
const credsInJSON = isJSON(process.env.GOOGLE_APPLICATION_CREDENTIALS)

// In local development, look for an auth.json file.
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  log.warn('GOOGLE_APPLICATION_CREDENTIALS was undefined, using default ./auth.json credentials file...')
  process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(__dirname, '.auth.json')
}


// only public method, returns the authClient that can be used for making other requests
exports.getAuth = async () => {
  if (authClient) return authClient
  await setAuthClient()
}

// configures the auth client if we don't already have one
async function setAuthClient() {
  return inflight('auth', async () => {
    // In Heroku environment, set GOOGLE_APPLICATION_CREDENTIALS as auth json object to be parsed
    if (credsInJSON) {
      const keys = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS)
      authClient = nodeAuth.fromJSON(keys);
    } else {
      const {credential} = await google.auth.getApplicationDefault()
      authClient = credential
    }
    
    if (authClient.createScopedRequired && authClient.createScopedRequired()) {
      authClient = authClient.createScoped([
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/datastore'
      ])
    }
    google.options({auth: authClient})
    log.info('Google API auth successfully retrieved.')

    return authClient
  })
}

function isJSON(str) {
  try {
    const obj = JSON.parse(str)
    if (obj && typeof obj === 'object' && obj !== null) {
        return true
      }
  } catch (err) {}
    return false
}
