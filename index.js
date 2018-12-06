const express = require('express')
const app = express()
const mongodb = require('mongodb')
const assert = require('assert')
const url = require('url')
const geolib = require('geolib');

// 定数
const mongoUri = process.env.MONGODB_URI
const DBNAME = process.env.MONGODB_DBNAME
const COLNAME = 'games'
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

// フェーズの情報
var phases = {
  1: {  // 開始前フェーズ
    totalTime: 0,
    check: (r) =>{
      // Nothing
    }
  },
  2: {  // 待機中フェーズ
    totalTime: 60000,
    check: (r) =>{
      console.log("2nd phase check")
      r["elaspedTime"] = Date.now() - r.absStartTime
      if(r["elaspedTime"] > this.totalTime){  // totalTime以上経過してたら犯人を決めて準備フェーズへ
        r.status = "3"
        var criminal = r.members[Math.floor( Math.random() * (r.members.length))]
        var positions = []
        r.members.forEach(function(v){
          positions.push({
            nickname: v,
            lat: "",
            lon: "",
            timestamp: ""
          })
        })
        r["absStartTime"] = Date.now()
        r["absEndTime"] = Date.now() + 600000
        r["totalTime"] = 600000
        r["elaspedTime"] = 0
        r["positions"] = positions
        r["criminal"] = criminal
        collection(COLNAME).updateOne({gameid: r.gameid}, {$set: r}).then(function(r2) {
          // Nothing
        })
      }
    }
  },
  3: {  // 準備フェーズ
    totalTime: 600000,
    check: (r) =>{
      console.log("3rd phase check")
      r["elaspedTime"] = Date.now() - r.absStartTime
      if(r["elaspedTime"] > this.totalTime){  // totalTime以上経過してたら犯人を決めて準備フェーズへ
        r["absStartTime"] = Date.now()
        r["absEndTime"] = Date.now() + 1800000
        r["totalTime"] = 1800000
        r["elaspedTime"] = 0
        collection(COLNAME).updateOne({gameid: r.gameid}, {$set: r}).then(function(r2) {
          // Nothing
        })
      }
    }
  },
  4: {  // プレイフェーズ
    totalTime: 1800000,
    check: (r) =>{
      console.log("4th phase check")
      r["elaspedTime"] = Date.now() - r.absStartTime
      if(r["elaspedTime"] > this.totalTime){  // totalTime以上経過してたら犯人を決めて準備フェーズへ
        r.catchResult = "failed"
        r.winner = "criminal"
        r.status = "5"
        collection(COLNAME).updateOne({gameid: r.gameid}, {$set: r}).then(function(r2) {
          // Nothing
        })
      }
    }
  },
  5: {  //終了フェーズ
    totalTime: 0,
    check: (r) =>{
      // Nothing
    }
  }
}

// ゲームIDを指定してゲームをすすめる
var processGame = function(gameid, ifGame, ifNoGame){
  // 既存ゲームの取得、処理
  collection(COLNAME).findOne({gameid: gameid}).then(function(r) {
    if(r){  // 存在する場合
      phases[r.status].check(r)
      ifGame(gameid, r)
    } else {  // 存在しない場合
      ifNoGame(gameid, r)
    }
  })
}

// /games/:gameid/join (POST)
app.post('/games/:gameid/join', function(request, response) {
  var req = request.body
  processGame(
    request.params.gameid,
    (gameid, r)=>{ // ゲームが存在した場合
      if(r.status != "2"){  // ステータスが異なる場合
        response.send(r)
      } else if(r){  // 募集中のゲームが存在する場合
        r.members.push(req.nickname)
        collection(COLNAME).updateOne({gameid:gameid}, {$set: r}).then(function(r2) {
          response.send(r)
        })
      }
    },
    (gameid, r)=>{ // ゲームが存在しない場合
      var game = {
        catchResult: "",
        winner: "",
        gameid: gameid,
        members: [req.nickname],
        criminal: "",
        absStartTime: Date.now(),
        absEndTime: Date.now() + phases["2"].totalTime,
        elaspedTime: "0",
        totalTime: phases["2"].totalTime,
        status: "2",
        positions: ""
      }
      collection(COLNAME).insertOne(game).then(function(r2) {
        response.send(game)
      })
    }
  )
})

// /games/:gameid/info (GET)
app.get('/games/:gameid/info', function(request, response) {
  var req = request.body
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
      if(r.status == "4"){  // ゲームフェーズ中の場合
        r.positions.map( function(v){
          if(v.nickname == req.nickname){
            v.timestamp = req.timestamp
            v.lat = req.lat
            v.lon = req.lon
          }
        })
        collection(COLNAME).updateOne({gameid: r.gameid}, {$set: r}).then(function(r2) {
          response.send(r)
        })
      } else {  // ゲームフェーズではない場合
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
  var req = request.body
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

// /games/:gameid/catch (POST)
app.post('/games/:gameid/catch', function(request, response) {
  var req = request.body
  processGame(
    request.params.gameid,
    (gameid, r)=>{ // ゲームが存在した場合
      if(r.status == "4"){  // プレイフェーズ中の場合
        var criminalPos = r.positions.criminal
        var policePoses = r.positions.police
        var closest = 99999999
        policePoses.forEach(function(v){
          var distance = geolib.getDistance(
            {latitude: v.lat, longitude: v.lon},
            {latitude: criminalPos.lat, longitude: criminalPos.lon}
          )
          if(closest>distance){closest=distance}
        })
        r.closestDistance = closest
        if(closest < 25){
          r.catchResult = "success"
          r.winner = "police"
          r.status = "5"
        } else {
          r.catchResult = "failed"
        }
        collection(COLNAME).updateOne({gameid: r.gameid}, {$set: r}).then(function(r2) {
          response.send(r)
        })
      } else {  // ゲームフェーズではない場合
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

// /games/:gameid/abort (POST)
app.post('/games/:gameid/abort', function(request, response) {
  var req = request.body
  processGame(
    request.params.gameid,
    (gameid, r)=>{ // ゲームが存在した場合
      collection(COLNAME).deleteOne({gameid: r.gameid}).then(function(r) {
        response.send()
      })
    },
    (gameid, r)=>{ // ゲームが存在しない場合
      response.status(404)
      response.send({ error: "Game Not Found" })
    }
  )
})

// Start to listen request
app.listen(app.get('port'), function() {
  console.log("Node app is running at localhost:" + app.get('port'))
})
