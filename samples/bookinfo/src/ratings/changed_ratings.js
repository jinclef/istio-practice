var http = require('http')
var dispatcher = require('httpdispatcher')

var port = parseInt(process.argv[2])

var unavailable = false
var healthy = true

// Redis 설정
const redis = require('redis');
const redisClient = redis.createClient({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
});

// Redis 연결 이벤트 처리
redisClient.on('connect', () => console.log('Connected to Redis'));
redisClient.on('error', (err) => console.error('Redis error:', err));

if (process.env.SERVICE_VERSION === 'v-unavailable') {
    // make the service unavailable once in 60 seconds
    setInterval(function () {
        unavailable = !unavailable
    }, 60000);
}

if (process.env.SERVICE_VERSION === 'v-unhealthy') {
    setInterval(function () {
        healthy = !healthy
        unavailable = !unavailable
    }, 900000);
}


/**
 * We default to using mongodb, if DB_TYPE is not set to mysql.
 */
if (process.env.SERVICE_VERSION === 'v2') {
  if (process.env.DB_TYPE === 'mysql') {
    var mysql = require('mysql')
    var hostName = process.env.MYSQL_DB_HOST
    var portNumber = process.env.MYSQL_DB_PORT
    var username = process.env.MYSQL_DB_USER
    var password = process.env.MYSQL_DB_PASSWORD
  } else {
    var MongoClient = require('mongodb').MongoClient
    var url = process.env.MONGO_DB_URL
  }
}

dispatcher.onPost(/^\/ratings\/[0-9]*/, function (req, res) {
  var productIdStr = req.url.split('/').pop()
  var productId = parseInt(productIdStr)
  var ratings = {}

  if (Number.isNaN(productId)) {
    res.writeHead(400, {'Content-type': 'application/json'})
    res.end(JSON.stringify({error: 'please provide numeric product ID'}))
    return
  }

  try {
    ratings = JSON.parse(req.body)
  } catch (error) {
    res.writeHead(400, {'Content-type': 'application/json'})
    res.end(JSON.stringify({error: 'please provide valid ratings JSON'}))
    return
  }

  if (process.env.SERVICE_VERSION === 'v2') { // the version that is backed by a database
    res.writeHead(501, {'Content-type': 'application/json'})
    res.end(JSON.stringify({error: 'Post not implemented for database backed ratings'}))
  } else {
    putRedisReviews(productId, ratings), function (err, result) {
        if (err) {
            res.writeHead(500, {'Content-type': 'application/json'})
            res.end(JSON.stringify({error: 'could not save ratings to Redis'}))
        } else {
            res.writeHead(200, {'Content-type': 'application/json'})
            res.end(JSON.stringify(result))
        }
    }
  }
})

dispatcher.onGet(/^\/ratings\/[0-9]*/, function (req, res) {
  var productIdStr = req.url.split('/').pop()
  var productId = parseInt(productIdStr)

  if (Number.isNaN(productId)) {
    res.writeHead(400, {'Content-type': 'application/json'})
    res.end(JSON.stringify({error: 'please provide numeric product ID'}))
  } else if (process.env.SERVICE_VERSION === 'v2') {
    var firstRating = 0
    var secondRating = 0

    if (process.env.DB_TYPE === 'mysql') {
      var connection = mysql.createConnection({
        host: hostName,
        port: portNumber,
        user: username,
        password: password,
        database: 'test'
      })

      connection.connect(function(err) {
          if (err) {
              res.end(JSON.stringify({error: 'could not connect to ratings database'}))
              console.log(err)
              return
          }
          connection.query('SELECT Rating FROM ratings', function (err, results, fields) {
              if (err) {
                  res.writeHead(500, {'Content-type': 'application/json'})
                  res.end(JSON.stringify({error: 'could not perform select'}))
                  console.log(err)
              } else {
                  if (results[0]) {
                      firstRating = results[0].Rating
                  }
                  if (results[1]) {
                      secondRating = results[1].Rating
                  }
                  var result = {
                      id: productId,
                      ratings: {
                          Reviewer1: firstRating,
                          Reviewer2: secondRating
                      }
                  }
                  res.writeHead(200, {'Content-type': 'application/json'})
                  res.end(JSON.stringify(result))
              }
          })
          // close the connection
          connection.end()
      })
    } else {
      MongoClient.connect(url, function (err, client) {
        if (err) {
          res.writeHead(500, {'Content-type': 'application/json'})
          res.end(JSON.stringify({error: 'could not connect to ratings database'}))
          console.log(err)
        } else {
          const db = client.db("test")
          db.collection('ratings').find({}).toArray(function (err, data) {
            if (err) {
              res.writeHead(500, {'Content-type': 'application/json'})
              res.end(JSON.stringify({error: 'could not load ratings from database'}))
              console.log(err)
            } else {
              if (data[0]) {
                firstRating = data[0].rating
              }
              if (data[1]) {
                secondRating = data[1].rating
              }
              var result = {
                id: productId,
                ratings: {
                  Reviewer1: firstRating,
                  Reviewer2: secondRating
                }
              }
              res.writeHead(200, {'Content-type': 'application/json'})
              res.end(JSON.stringify(result))
            }
            // close client once done:
            client.close()
          })
        }
      })
    }
  } else {
      if (process.env.SERVICE_VERSION === 'v-faulty') {
        // in half of the cases return error,
        // in another half proceed as usual
        var random = Math.random(); // returns [0,1]
        if (random <= 0.5) {
          getReviewsServiceUnavailable_503(res)
        } else {
            getRedisReviews(productId, (err, result) => {
                if (err) {
                    getReviewsServiceUnavailable_503(res);
                } else {
                    res.writeHead(200, { 'Content-type': 'application/json' });
                    res.end(JSON.stringify(result));
                }
            });
        }
      }
      else if (process.env.SERVICE_VERSION === 'v-delayed') {
        // in half of the cases delay for 7 seconds,
        // in another half proceed as usual
        var random = Math.random(); // returns [0,1]
        if (random <= 0.5) {
            setTimeout(() => {
                getRedisReviews(productId, (err, result) => {
                    if (err) {
                        getReviewsServiceUnavailable_503(res);
                    } else {
                        res.writeHead(200, { 'Content-type': 'application/json' });
                        res.end(JSON.stringify(result));
                    }
                });
            }, 7000);
        } else {
            getRedisReviews(productId, (err, result) => {
                if (err) {
                    getReviewsServiceUnavailable_503(res);
                } else {
                    res.writeHead(200, { 'Content-type': 'application/json' });
                    res.end(JSON.stringify(result));
                }
            });
        }
      }
      else if (process.env.SERVICE_VERSION === 'v-unavailable' || process.env.SERVICE_VERSION === 'v-unhealthy') {
          if (unavailable) {
              getReviewsServiceUnavailable_503(res)
          } else {
            getRedisReviews(productId, (err, result) => {
                if (err) {
                    getReviewsServiceUnavailable_503(res);
                } else {
                    res.writeHead(200, { 'Content-type': 'application/json' });
                    res.end(JSON.stringify(result));
                }
            });
          }
      }
      else {
        getRedisReviews(productId, (err, result) => {
            if (err) {
                res.writeHead(500, { 'Content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'could not load ratings from Redis' }));
            } else {
                res.writeHead(200, { 'Content-type': 'application/json' });
                res.end(JSON.stringify(result));
            }
        });
      }
  }
})

dispatcher.onGet('/health', function (req, res) {
    if (healthy) {
        res.writeHead(200, {'Content-type': 'application/json'})
        res.end(JSON.stringify({status: 'Ratings is healthy'}))
    } else {
        res.writeHead(500, {'Content-type': 'application/json'})
        res.end(JSON.stringify({status: 'Ratings is not healthy'}))
    }
})

// Redis에 데이터를 저장하는 함수
function putRedisReviews(productId, ratings) {
    const key = `product:${productId}`;
    const value = JSON.stringify({
        id: productId,
        ratings: ratings
    });
    
    redisClient.set(key, value, (err) => {
        if (err)  callback(err, null);
        else      getRedisReviews(productId, callback); // 저장 후 데이터를 반환
    });
}
  
// Redis에서 데이터를 가져오는 함수
function getRedisReviews(productId) {
    return new Promise((resolve, reject) => {
        const key = `product:${productId}`;
        redisClient.get(key, (err, data) => {
            if (err) {
                reject(err);
            } else if (data) {
                resolve(JSON.parse(data));
            } else {
                resolve({
                    id: productId,
                    ratings: {
                        'Reviewer1' : 12,
                        'Reviewer2' : 25 // 확인을 위해 기존과 다른 값 설정
                    }
                });
            }
        });
    });
}
  
function getReviewsServiceUnavailable_503(res) {
  res.writeHead(503, {'Content-type': 'application/json'})
  res.end(JSON.stringify({error: 'Service unavailable'}))
}

function handleRequest (request, response) {
  try {
    console.log(request.method + ' ' + request.url)
    dispatcher.dispatch(request, response)
  } catch (err) {
    console.log(err)
  }
}

var server = http.createServer(handleRequest)

process.on('SIGTERM', function () {
  console.log("SIGTERM received")
  server.close(function () {
    process.exit(0);
  });
});

server.listen(port, function () {
  console.log('Server listening on: http://0.0.0.0:%s', port)
})
