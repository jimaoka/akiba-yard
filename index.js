const express = require('express')
const app = express()
const mongodb = require('mongodb')
const assert = require('assert')
const url = require('url')

// 定数
const mongoUri = process.env.MONGODB_URI
const DBNAME = process.env.MONGODB_DBNAME
const COLNAME = 'akibaTest'
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
var collection = function(name) {
  return database.collection(name)
}

// アプリから位置情報を送るための受け口
app.post('/position', function(request, response) {
  collection(COLNAME).insertOne(request.body).then(function(r) {
    response.send(r)
  })
})

// アプリから他端末を含めた位置情報を取得するための受け口
app.get('/position', function(request, response) {
  var urlParams = url.parse(request.url, true)
  collection(COLNAME).find().toArray(function(err, docs){
      response.send(docs)
  })
})

// アプリから他端末を含めた位置情報を取得するための受け口(一つだけ返す)
app.get('/position/latest', function(request, response) {
  collection(COLNAME).group(
    ['id'],
    {},
    {'maxValue': 0},
    "function(obj,prev){ if(prev.maxValue<obj.value){ prev.maxValue = obj.value }}",
    (err, docs) => {
      console.log(JSON.stringify(docs))
      response.send(docs)
    }
  )
  /*
  collection(COLNAME).aggregate([
    {
      $sort: { timestamp: -1 }
    },
    {
      $group: {
        _id: "$id",
        targets: { $push: "$_id" },
        count: { $sum: 1 }
      }
    },
    {
      $match: { count: { $gt: 1 } }
    },
  ]).toArray().then((docs) => {
    console.log(JSON.stringify(docs))
    response.send(docs)
  })
  */
})

// Start listen request
app.listen(app.get('port'), function() {
  console.log("Node app is running at localhost:" + app.get('port'))
})
