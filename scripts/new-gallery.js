/* This is a script to create a new post markdown file with front-matter */

import fs from 'fs';
import path from 'path';

function getDate() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

const args = process.argv.slice(2);

if (args.length === 0) {
    console.error(`Error: No dirname argument provided
Usage: npm run new-gallery <dirname>`);
    process.exit(1); // Terminate the script and return error code 1
}

const dirName = args[0];

const targetDir = './public/gallery/';
const fullPath = path.join(targetDir, dirName);

if (fs.existsSync(fullPath)) {
    console.error(`Error: Directory ${fullPath} already exists `);
    process.exit(1);
}

// 创建目录
if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
}

// 创建urls.txt文件
fs.writeFileSync(path.join(fullPath, 'urls.txt'), '');

// 在galleryConfig.ts中添加相册
const galleryInfo = `\t\t{
\t\t\tid: "${dirName}",
\t\t\tname: "${dirName}",
\t\t\tdescription: "相册描述",
\t\t\tlocation: "相册地点",
\t\t\tdate: "${getDate()}",
\t\t\tcover: "",
\t\t\tcomment: true,
\t\t},`;

const galleryConfigPath = path.join('./src/config/galleryConfig.ts');
let galleryConfig = fs.readFileSync(galleryConfigPath, 'utf-8');
// 在 albums 数组最后一个元素前插入新的相册配置
galleryConfig = galleryConfig.replace(/\t],\n\n\t\/\/ 瀑布流最小列宽/, `${galleryInfo}\n\t],\n\n\t// 瀑布流最小列宽`);
fs.writeFileSync(galleryConfigPath, galleryConfig);

console.log(`Gallery ${fullPath} created`);
