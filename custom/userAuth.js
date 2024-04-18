'use strict'

const passport = require('passport')
const session = require('express-session')
const crypto = require('crypto')
const GoogleStrategy = require('passport-google-oauth20')

const {Datastore} = require('@google-cloud/datastore');
const {DatastoreStore} = require('@google-cloud/connect-datastore');

const {getAuth} = require('../server/auth')
const log = require('../server/logger')

const router = require('express-promise-router')()
const domains = new Set(process.env.APPROVED_DOMAINS.split(/,\s?/g))

const axios = require('axios')

const callbackURL = process.env.REDIRECT_URL || '/auth/redirect'
const GOOGLE_AUTH_STRATEGY = 'google'

getAuth().then(({email, key}) => {
  passport.use(new GoogleStrategy.Strategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL,
      userProfileURL: 'https://www.googleapis.com/oauth2/v3/userinfo',
      passReqToCallback: true
  }, (request, accessToken, refreshToken, profile, done) => done(null, profile)))

  router.use(session({
    secret: process.env.SESSION_SECRET,
    resave: true,
    saveUninitialized: true,

    store: new DatastoreStore({
      kind: 'express-sessions',
      expirationMs: 0,
      dataset: new Datastore({
        credentials: {
          client_email: email,
          private_key: key
        },
        projectId: process.env.GCP_PROJECT_ID,
      })
    }),

  }))

  router.use(passport.initialize())
  router.use(passport.session())

  // seralize/deseralization methods for extracting user information from the
  // session cookie and adding it to the req.passport object

  // serialize is called when the user first authenticates
  // Use this callback as an opportunity to check their email against the chive permissions list
  // and attach an "authorized" flag to their PassportJS object
  passport.serializeUser(async (user, done) => {
    user.authorized = false;

    // magic Google Apps Script; takes a "user" parameter in a GET request and returns a JSON object with an "authorized" key
    const authUrl = "https://script.google.com/macros/s/AKfycby3zj7uw2ZHi6JUcCt8aaRoE3Z8lUo3uKojxGXXIgeCoJ9h78CvXGJasUl--t23JfxB/exec"

    try {
      // TODO: Technically there could be more than one email attached to a profile - should we send all of them?
      var authResp = await axios.get(authUrl, {params: {user: user.emails[0].value}})

      if (authResp.data.authorized) {
        user.authorized = true;
      }
    } catch (e) {
      console.log(e)
    }

    // save the user object and finish serializing it
    done(null, user)
  })

  // deserialize is called anytime the user loads a new page; no need to re-check authorization
  // However, if user is added to permissions list *after* they first log in, they will need to re-log-in
  // by visiting /login or /logout
  passport.deserializeUser((obj, done) => done(null, obj))

  const googleLoginOptions = {
    scope: [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ],
    prompt: 'select_account'
  }

  router.get('/login', passport.authenticate(GOOGLE_AUTH_STRATEGY, googleLoginOptions))

  router.get('/logout', (req, res) => {
    req.logout()
    res.redirect('/')
  })

  router.get('/auth/redirect', passport.authenticate(GOOGLE_AUTH_STRATEGY, {failureRedirect: '/login'}), (req, res) => {
    res.redirect(req.session.authRedirect || '/')
  })

  router.use((req, res, next) => {
    const isDev = process.env.NODE_ENV === 'development'
    const passportUser = (req.session.passport || {}).user || {}
    if (isDev || (req.isAuthenticated() && isAuthorized(passportUser))) {
      setUserInfo(req)
      return next()
    }

    if (req.isAuthenticated() && !isAuthorized(passportUser)) {
      return next(Error('Unauthorized'))
    }

    log.info('User not authenticated')
    req.session.authRedirect = req.path
    res.redirect('/login')
  })

  function isAuthorized(user) {
    return user.authorized
  }

  function setUserInfo(req) {
    const md5 = (data) => crypto.createHash('md5').update(data).digest('hex')

    if (process.env.NODE_ENV === 'development') {
      req.userInfo = {
        email: process.env.TEST_EMAIL || 'test@example.com',
        userId: '10',
        analyticsUserId: md5('10library')
      }
      return
    }
    const email = req.session.passport.user.emails[0].value
    req.userInfo = req.userInfo ? req.userInfo : {
      userId: req.session.passport.user.id,
      analyticsUserId: md5(req.session.passport.user.id + 'library'),
      email
    }
  }
});

module.exports = router
