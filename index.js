const express = require('express')
const app = express()
const mongodb = require('mongodb')
const assert = require('assert')
const url = require('url')

// 定数
const mongoUri = process.env.MONGODB_URI
const DBNAME = process.env.MONGODB_DBNAME
const COLNAME = 'games'
const testData = require('./resource/testData.json')
const testDataLatest = require('./resource/testDataLatest.json')
const MongoClient = mongodb.MongoClient

// 処々の初期化処理
app.set('port', (process.env.PORT || 443))
app.use(express.static(__dirname + '/public'))
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

// データベース初期化
var database
MongoClient.connect(mongoUri, (err, client) => {
  assert.equal(null, err)
  console.log("Connected successfully to server")
  database=client.db(DBNAME)
})
var collection = function(name, options) {
  return database.collection(name, options)
}

// ステータス遷移のチェック
var statusCheck = function(r) {
  // チェック用の関数
  var transition = {
    1: function(r) {
      // Nothing
    }, 
    2: function(r) {
      if(Date.now() - r.time > 60000){  // 60s以上経過してたらゲーム開始処理
        r.status = "3"
        var criminalPos = Math.floor( Math.random() * (r.members.length) )
        var criminal = r.members[criminalPos]
        var police = []
        r.members.forEach(function(v){
          if(v != criminal){
            police.push({
              nickname: v,
              lat: "",
              lon: ""
            })
          }
        })
        var positions = {
          police: police,
          criminal: {nickname: criminal, lat: "", lon: ""}
        }
        r["time"] = Date.now()
        r["positions"] = positions
        r["criminal"] = criminal
        collection(COLNAME).updateOne(r.gameid, {$set: r}).then(function(r2) {
          // Nothing
        })
      }
    },
    3: function(r){},
    4: function(r){},
    5: function(r){}
  }
  transition[r.status](r)
}

// ゲームIDを指定してゲームをすすめる
var processGame = function(gameid, ifGame, ifNoGame){
  // 既存ゲームの取得、処理
  collection(COLNAME).findOne({gameid: gameid}).then(function(r) {
    if(r){  // 存在する場合
      statusCheck(r)
      ifGame(gameid, r)
    } else {  // 存在しない場合
      ifNoGame(gameid, r)
    }
  })
}

// /games/:gameid/join (POST)
app.post('/games/:gameid/join', function(request, response) {
  var nickname = request.body.nickname
  processGame(
    request.params.gameid,
    (gameid, r)=>{ // ゲームが存在した場合
      if(r.status != "2"){  // ステータスが異なる場合
        response.send(r)
      } else if(r){  // 募集中のゲームが存在する場合
        r.members.push(nickname)
        collection(COLNAME).updateOne({gameid:gameid}, {$set: r}).then(function(r2) {
          response.send(r)
        })
      }
    },
    (gameid, r)=>{ // ゲームが存在しない場合
      var game = {
        gameid: gameid,
        members: [nickname],
        criminal: "",
        time: Date.now(),
        status: "2"
      }
      collection(COLNAME).insertOne(game).then(function(r2) {
        response.send(game)
      })
    }
  )
})

// /games/:gameid/info (GET)
app.get('/games/:gameid/info', function(request, response) {
  processGame(
    request.params.gameid,
    (gameid, r)=>{ // ゲームが存在した場合
      response.send(r)
    },
    (gameid, r)=>{ // ゲームが存在しない場合
      response.status(404)
      response.send({ error: "Game Not Found" })
    }
  )
})

// /games/:gameid/position (POST)
app.post('/games/:gameid/position', function(request, response) {
  var req = request.body
  processGame(
    request.params.gameid,
    (gameid, r)=>{ // ゲームが存在した場合
      if(r.status == "3"){  // ゲームフェーズ中の場合
        r.positions.police.map( function(v){
          if(v.nickname == req.nickname){
            v.timestamp = req.timestamp
            v.lat = req.lat
            v.lon = req.lon
          }
        })
        if(r.positions.criminal.nickname == req.nickname){
            r.positions.criminal.timestamp = req.timestamp
            r.positions.criminal.lat = req.lat
            r.positions.criminal.lon = req.lon
        }
        collection(COLNAME).updateOne(q, {$set: r}).then(function(r2) {
          response.send(r)
        })
      } else {
        response.status(404)
        response.send({ error: "Active Game Not Found" })  
      }
    },
    (gameid, r)=>{ // ゲームが存在しない場合
      response.status(404)
      response.send({ error: "Game Not Found" })
    }
  )
})

// /games/:gameid/position (GET)
app.get('/games/:gameid/position', function(request, response) {
  var gameid = request.params.gameid
  var q = { gameid: gameid }
  // 既存ゲームの取得
  collection(COLNAME).findOne(q).then(function(r) {
    if(r){  // 存在する場合
      statusCheck(r)
      collection(COLNAME).updateOne(q, {$set: r}).then(function(r2) {
        response.send(r)
      })
    } else {  // 存在しない場合
      response.status(404)
      response.send({ error: "Game Not Found" })
    }
  })
})

// /games/:gameid/catch (POST)
app.post('/games/:gameid/catch', function(request, response) {
  var req = JSON.stringify(request.body)
  // リクエストをインサートして内容を返す
  collection(COLNAME).insertOne(request.body).then(function(r) {
    response.send(req)
  })
})

// /games/:gameid/abort (POST)
app.post('/games/:gameid/abort', function(request, response) {
  var req = JSON.stringify(request.body)
  // リクエストをインサートして内容を返す
  collection(COLNAME).insertOne(request.body).then(function(r) {
    response.send(req)
  })
})

// アプリから他端末を含めた位置情報を取得するための受け口(一つだけ返す)
app.get('/position/latest', function(request, response) {
  // ID毎に最新のものをクエリして返す
  collection(COLNAME).group(
    ['id'],
    {},
    {'latestTime': 0, 'lat': 0, 'lon': 0},
    "function(obj,prev){ if(prev.latestTime<obj.timestamp){ prev.latestTime = obj.timestamp; prev.lat = obj.lat; prev.lon = obj.lon }}",
    (err, docs) => {
      console.log(JSON.stringify(docs))
      response.send(docs)
    }
  )
})

// Start listen request
app.listen(app.get('port'), function() {
  console.log("Node app is running at localhost:" + app.get('port'))
})
