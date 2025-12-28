
const fs = require('fs');
const path = require('path');
const natural = require('natural');

// 範例：一筆電影資料
const movieData = {
  title: 'The Matrix',
  year: 1999,
  genre: 'Action, Sci-Fi',
  imdbRating: 8.7,
  director: 'Lana Wachowski, Lilly Wachowski',
  runtime: '136 min',
  language: 'English',
  actors: 'Keanu Reeves, Laurence Fishburne, Carrie-Anne Moss, Hugo Weaving, Gloria Foster, Joe Pantoliano',
  plot: 'The Matrix is a 1999 science fiction action film written and directed by the Wachowskis. It is the first installment in the Matrix film series, starring Keanu Reeves, Laurence Fishburne, Carrie-Anne Moss, Hugo Weaving, and Joe Pantoliano. It depicts a dystopian future in which humanity is unknowingly trapped inside the Matrix, a simulated reality created by intelligent machines.'
};


function generateMovieVector(movie) {
  // 把劇情和演員名字合成一段文字，作為文本特徵
  const text = [movie.plot, movie.actors].filter(Boolean).join(' ');
  const tfidf = new natural.TfIdf();
  tfidf.addDocument(text);
  // 取得 TF-IDF 權重向量
  const tfidfVector = tfidf.listTerms(0).map(term => term.tfidf);

  // 把 IMDb 評分和片長轉成數值並標準化
  let runtime = Number(movie.runtime);
  if (typeof movie.runtime === 'string') {
    const m = movie.runtime.match(/\d+/);
    runtime = m ? Number(m[0]) : 0;
  }
  const numeric = [Number(movie.imdbRating), runtime];
  const normNumeric = standardizeData(numeric);

  // 合併文本特徵和數值特徵
  return [...tfidfVector, ...normNumeric];
}


if (require.main === module) {
  const vector = generateMovieVector(movieData);

  // 輸出向量到本地 JSON 檔案
  const outDir = path.join(__dirname, 'movie-vectors');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir);
  }
  const outFile = path.join(outDir, 'the_matrix_vector.json');
  fs.writeFileSync(outFile, JSON.stringify(vector));
  console.log('Movie vector saved to:', outFile);
  console.log('Final Movie Vector:');
  console.log(vector);
}


module.exports = { generateMovieVector };


// 把數值型欄位壓到 0~1 區間
function standardizeData(arr) {
  const max = Math.max(...arr);
  const min = Math.min(...arr);
  if (!Number.isFinite(max) || !Number.isFinite(min) || max === min) {
    return arr.map(() => 0);
  }
  return arr.map(x => (x - min) / (max - min));
}
