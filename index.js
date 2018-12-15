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

const PH2_TIME_LIMIT = 60 * 1000
const PH3_TIME_LIMIT = 600 * 1000
const PH4_TIME_LIMIT = 1800 * 1000

// フェーズの情報
var phases = {
  1: {  // 開始前フェーズ
    check: (r) =>{
      // Nothing
    }
  },
  2: {  // 待機中フェーズ
    check: (r) =>{
      console.log("2nd phase check")
      r["elapsedTime"] = Date.now() - r.absStartTime
      if(r["elapsedTime"] > PH2_TIME_LIMIT){  // totalTime以上経過してたら犯人を決めて準備フェーズへ
        console.log("move to 3rd phase")
        r.status = "3"
        var criminal = r.members[Math.floor( Math.random() * (r.members.length))]
        if(r.criminal != ""){criminal = r.criminal}
        var positions = []
        r.members.forEach(function(v){
          positions.push({
            nickname: v,
            pos: []
          })
        })
        r["absStartTime"] = Date.now()
        r["absEndTime"] = Date.now() + r.ph3TotalTime
        r["totalTime"] = r.ph3TotalTime
        r["elapsedTime"] = 0
        r["positions"] = positions
        r["criminal"] = criminal
      }
    }
  },
  3: {  // 準備フェーズ
    check: (r) =>{
      console.log("3rd phase check")
      r["elapsedTime"] = Date.now() - r.absStartTime
      if(r["elapsedTime"] > r.ph3TotalTime){  // totalTime以上経過してたら犯人を決めて準備フェーズへ
        r.status = "4"
        r["absStartTime"] = Date.now()
        r["absEndTime"] = Date.now() + r.ph4TotalTime
        r["totalTime"] = r.ph4TotalTime
        r["elapsedTime"] = 0
      }
    }
  },
  4: {  // プレイフェーズ
    check: (r) =>{
      console.log("4th phase check")
      r["elapsedTime"] = Date.now() - r.absStartTime
      if(r["elapsedTime"] > r.ph4TotalTime){  // totalTime以上経過してたら犯人を決めて準備フェーズへ
        r.catchResult.result = "failed"
        r.winner = "criminal"
        r.status = "5"
      }
    }
  },
  5: {  //終了フェーズ
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

// 配列から最新の位置情報を比較して取ってくる
var getLatestPos = function(pos, nickname) {
  var latestPos = {nickname: "", timestamp:0, lat: 0, lon: 0}
  pos.forEach(function(v){
    if(v.timestamp > latestPos.timestamp){
      latestPos = {nickname: nickname, timestamp: v.timestamp, lat: v.lat, lon: v.lon}
    }
  })
  return latestPos
}

// 指定した時間に一番近い位置情報を返す
var getClosestPos = function(pos, nickname, timestamp) {
  var closestPos = {nickname: "", timestamp:0, lat: 0, lon: 0, timeDiff: 999999999999}
  pos.forEach(function(v){
    if( closestPos.timeDiff > Math.abs(v.timestamp - timestamp)){
      closestPos = {nickname: nickname, timestamp: v.timestamp, lat: v.lat, lon: v.lon}
    }
  })
  return closestPos
}

// 配列からQuantumの位置情報配列を返す
var getQuantumPos = function(pos, nickname) {
  var t = Date.now()
  var p = getLatestPos(pos, nickname)
  var deltaT = 60000
  var tDash = t - deltaT
  var pDash = getClosestPos(pos, nickname, tDash)
  // 自分でやったやつ
  var deltaP = geolib.getDistance(
    {latitude: p.lat, longitude: p.lon},
    {latitude: pDash.lat, longitude: pDash.lon}
  )
  var v = deltaP / (deltaT / 10000)
  /*
  p.time = p.timestamp
  pDash.time = pDash.timestamp
  var v = geolib.getSpeed(p, pDash, {unit: 'mps'})
  */
  if( v < 0.4) { v = 0.4 }
  var deltaX = 40 / v
  var meterToLat = 0.000008983148616 // メートルに掛けると緯度出る係数
  var meterToLon = 0.000010966382364 // メートルに掛けると経度出る係数
  var rand1 = Math.random() * 2 - 1.0
  var rand2 = Math.random() * 2 - 1.0
  var latDash = p.lat + deltaX * rand1 * meterToLat
  var lonDash = p.lon + deltaX * rand2 * meterToLon
  console.log( {t:t, p:p, deltaT:deltaT, tDash:tDash, pDash:pDash, deltaP:deltaP, v:v, deltaX:deltaX, latDash:latDash, lonDash:lonDash} )
  return {lat: latDash, lon: lonDash, nickname: nickname, timestamp: p.timestamp}
}

// 最新の位置情報を取得する
var getPositions = function(r, quantum){
  var ret = {positions: []}
  var positions = r.positions
  positions.forEach(function(v){
    if(v.nickname == r.criminal && quantum){
      // Quantum!!!
      for (var i = 0; i < 10; i++) {
        ret.positions.push(getQuantumPos(v.pos, v.nickname))
      }
    } else {
      // Classic
      ret.positions.push(getLatestPos(v.pos, v.nickname))
    }
  })
  return ret
}

// /games/:gameid/join (POST)
app.post('/games/:gameid/join', function(request, response) {
  var req = request.body
  console.log(req)
  processGame(
    request.params.gameid,
    (gameid, r)=>{ // ゲームが存在した場合
      if(r.status != "2"){  // ステータスが異なる場合
        delete r['positions']
        delete r['_id']
        response.send(r)
      } else if(r){  // 募集中のゲームが存在する場合
        r.members.push(req.nickname)
        collection(COLNAME).updateOne({gameid:gameid}, {$set: r}).then(function(r2) {
          delete r['positions']
          delete r['_id']
          console.log(r)
          response.send(r)
        })
      }
    },
    (gameid, r)=>{ // ゲームが存在しない場合
      var ph3TotalTime = PH3_TIME_LIMIT
      var ph4TotalTime = PH4_TIME_LIMIT
      var criminal = ""
      if(req.ph3TotalTime){ph3TotalTime = Number(req.ph3TotalTime)}
      if(req.ph4TotalTime){ph4TotalTime = Number(req.ph4TotalTime)}
      if(req.criminal){criminal = req.criminal}
      var r = {
        catchResult: {nickname: "", result: "", timestamp: 0, distance: 99999},
        winner: "",
        gameid: gameid,
        members: [req.nickname],
        criminal: criminal,
        absStartTime: Date.now(),
        absEndTime: Date.now() + PH2_TIME_LIMIT,
        elapsedTime: 0,
        totalTime: PH2_TIME_LIMIT,
        ph3TotalTime: ph3TotalTime,
        ph4TotalTime: ph4TotalTime,
        refreshInterval: req.refreshInterval,
        status: "2",
        positions: ""
      }
      collection(COLNAME).insertOne(r).then(function(r2) {
        delete r['positions']
        delete r['_id']
        console.log(r)
        response.send(r)
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
      collection(COLNAME).updateOne({gameid: r.gameid}, {$set: r}).then(function(r2) {
        delete r['positions']
        delete r['_id']
        console.log(r)
        response.send(r)
      })
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
  console.log(req)
  processGame(
    request.params.gameid,
    (gameid, r)=>{ // ゲームが存在した場合
      if(r){  // 準備フェーズかゲームフェーズ中の場合
        r.positions.map( function(v){
          if(v.nickname == req.nickname){
            v.pos.push({timestamp: req.timestamp, lat: req.lat, lon: req.lon})
          }
        })
        collection(COLNAME).updateOne({gameid: r.gameid}, {$set: r}).then(function(r2) {
          delete r['positions']
          delete r['_id']
          console.log(r)
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
  console.log(req)
  processGame(
    request.params.gameid,
    (gameid, r)=>{ // ゲームが存在した場合
      collection(COLNAME).updateOne({gameid: r.gameid}, {$set: r}).then(function(r2) {
        delete r['_id']
        var latestPos = getPositions(r, true)
        console.log(latestPos)
        response.send(latestPos)
      })
    },
    (gameid, r)=>{ // ゲームが存在しない場合
      response.status(404)
      response.send({ error: "Game Not Found" })
    }
  )
})

// /games/:gameid/position/all (GET)
app.get('/games/:gameid/position/all', function(request, response) {
  var req = request.body
  console.log(req)
  processGame(
    request.params.gameid,
    (gameid, r)=>{ // ゲームが存在した場合
      collection(COLNAME).updateOne({gameid: r.gameid}, {$set: r}).then(function(r2) {
        delete r['_id']
        var allPos = {positions: r.positions}
        console.log(allPos)
        response.send(allPos)
      })
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
  console.log(req)
  processGame(
    request.params.gameid,
    (gameid, r)=>{ // ゲームが存在した場合
      if(r.status == "4"){  // プレイフェーズ中の場合
        var latestPos = getPositions(r, false)
        var positions = latestPos.positions
        var criminalPos = {}
        positions.forEach(function(v){
          if(v.nickname == r.criminal){criminalPos = v}
        })
        var closest = 99999999
        positions.forEach(function(v){
          if(criminalPos.nickname != v.nickname){
            var distance = geolib.getDistance(
              {latitude: v.lat, longitude: v.lon},
              {latitude: criminalPos.lat, longitude: criminalPos.lon}
            )
            if(closest>distance){closest=distance}
          }
        })
        r.catchResult.distance = closest
        r.catchResult.nickname = req.nickname
        r.catchResult.timestamp = Date.now()
        if(closest < 25){
          r.catchResult.result = "success"
          r.winner = "police"
          r.status = "5"
        } else {
          r.catchResult.result = "failed"
        }
        collection(COLNAME).updateOne({gameid: r.gameid}, {$set: r}).then(function(r2) {
          delete r['positions']
          delete r['_id']
          console.log(r)
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
  console.log(req)
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
