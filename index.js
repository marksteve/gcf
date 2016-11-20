const url = require('url')
const { json } = require('micro')
const request = require('request-promise')
const shuffle = require('shuffle-array')

const { REDIS_HOST, VERIFY_TOKEN, PAGE_TOKEN } = process.env

const Redis = require('ioredis')
const redis = new Redis(6379, REDIS_HOST || 'localhost')

const API_URI = 'https://graph.facebook.com/v2.6/me/messages'
const BUCKET_URI = 'https://storage.googleapis.com/pinoy-logos-quiz'

module.exports = async function (req, res) {
  if (req.method === 'GET') {
    const { query } = url.parse(req.url, true)
    if (query['hub.verify_token'] === VERIFY_TOKEN) {
      return query['hub.challenge']
    }
    return 'invalid_verify_token'
  } else {
    const callback = await json(req)
    callback.entry.forEach(processEntry)
  }
  return ''
}

function processEntry (entry) {
  entry.messaging.forEach(processMessaging)
}

function getState (sender) {
  return redis.hgetall(`plq:states:${sender.id}`)
}

function setState (sender, key, value) {
  return redis.hset(`plq:states:${sender.id}`, key, value)
}

function clearState (sender) {
  return redis.del(`plq:states:${sender.id}`)
}

function sendMessage (recipient, message) {
  return request({
    uri: API_URI,
    method: 'POST',
    qs: { access_token: PAGE_TOKEN },
    body: { recipient, message },
    json: true
  })
}

function showPLQLogo (sender) {
  return getState(sender)
    .then(function (state) {
      const currLogo = parseInt(state.plq_index)
      const logos = JSON.parse(state.plq_level_logos)
      sendMessage(sender, {
        attachment: {
          type: 'image',
          payload: {
            url: `${BUCKET_URI}/${state.plq_level}/${logos[currLogo]}`
          }
        }
      })
      if (currLogo + 1 >= logos.length) {
        clearState(sender)
        return sendMessage(sender, {
          text: 'Game Over'
        })
      }
      setState(sender, 'plq_lives', 3)
    })
}

function setPLQLevel (sender, level) {
  setState(sender, 'plq_level', level)
  const { name, logos }  = require(`./${level}.json`)
  let logoKeys = Object.keys(logos)
  shuffle(logoKeys)
  setState(sender, 'plq_index', 0)
  setState(sender, 'plq_logo', logoKeys[0])
  setState(sender, 'plq_level_logos', JSON.stringify(logoKeys))
    .then(showPLQLogo(sender))
  sendMessage(sender, { text: name })
}

function startPLQ (sender) {
  setState(sender, 'game', 'plq')
  setPLQLevel(sender, 'level-1')
}

function processMessage (sender, state, message) {
  if (state.game === 'plq') {
    const { logos } = require(`./${state.plq_level}.json`)
    const logo = logos[state.plq_logo]
    const answer = logo.answers.indexOf(message.text.toLowerCase())
    if (~answer) {
      sendMessage(sender, { text: 'Correct!' })
      const nextIndex = parseInt(state.plq_index, 10) + 1
      const logo = JSON.parse(state.plq_level_logos)[nextIndex]
      setState(sender, 'plq_index', nextIndex)
        .then(setState(sender, 'plq_logo', logo))
        .then(showPLQLogo(sender))
    } else {
      sendMessage(sender, { text: 'Wrong!' })
      // TODO: Subtract lives
    }
  }
}

function processQuickReply (sender, state, message) {
  switch (message.quick_reply.payload) {
    case 'start:plq': return startPLQ(sender, state, message)
  }
}

function processMessaging (messaging) {
  const { sender, message } = messaging
  getState(sender)
    .then(function (state) {
      if (message.quick_reply) {
        return processQuickReply(sender, state, message)
      } else {
        processMessage(sender, state, message)
      }
      if (Object.keys(state).length === 0) {
        sendMessage(sender, {
          text: 'Welcome to Good Clean Fun! What do you want to play today?',
          quick_replies: [
            { content_type: 'text', title: '🇵🇭 Pinoy Logos Quiz', payload: 'start:plq' }
          ]
        })
      }
    })
}
