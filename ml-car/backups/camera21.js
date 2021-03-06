/**
 * @license
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licnses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */
// import dat from 'dat.gui';
// import Stats from 'stats.js';
// import * as posenet from '../src';

// import { drawKeypoints, drawSkeleton } from './demo_util';


const videoWidth = 500;   // was 600
const videoHeight = 500;    // was 500
const stats = new Stats();

function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

function isiOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isMobile() {
  return isAndroid() || isiOS();
}

/**
 * Loads a the camera to be used in the demo
 *
 */
async function setupCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw 'Browser API navigator.mediaDevices.getUserMedia not available';
  }

  const video = document.getElementById('video');
  video.width = videoWidth;
  video.height = videoHeight;

  const mobile = isMobile();
  const stream = await navigator.mediaDevices.getUserMedia({
    'audio': false,
    'video': {
      facingMode: 'user',
      width: mobile ? undefined : videoWidth,
      height: mobile ? undefined: videoHeight}
  });
  video.srcObject = stream;

  return new Promise(resolve => {
    video.onloadedmetadata = () => {
      resolve(video);
    };
  });
}

async function loadVideo() {
  const video = await setupCamera();
  video.play();

  return video;
}

const guiState = {
  algorithm: 'single-pose',
  input: {
   // mobileNetArchitecture: isMobile() ? '0.50' : '1.01',  // for normal cell phones
    mobileNetArchitecture: '0.50',
    outputStride: 32,  //  was 16
    imageScaleFactor: 0.5,   //  was 0.5
  },
  singlePoseDetection: {
    minPoseConfidence: 0.1,
    minPartConfidence: 0.5,
  },
  multiPoseDetection: {
    maxPoseDetections: 2,
    minPoseConfidence: 0.1,
    minPartConfidence: 0.3,
    nmsRadius: 20.0,
  },
  output: {
    showVideo: true,
    showSkeleton: true,
    showPoints: true,
  },
  net: null,
};

/**
 * Sets up dat.gui controller on the top-right of the window
 */
function setupGui(cameras, net) {
  guiState.net = net;

  if (cameras.length > 0) {
    guiState.camera = cameras[0].deviceId;
  }

  const cameraOptions = cameras.reduce((result, { label, deviceId }) => {
    result[label] = deviceId;
    return result;
  }, {});

  const gui = new dat.GUI({ width: 300 });

  // The single-pose algorithm is faster and simpler but requires only one person to be
  // in the frame or results will be innaccurate. Multi-pose works for more than 1 person
  const algorithmController = gui.add(
    guiState, 'algorithm', ['single-pose', 'multi-pose']);

  // The input parameters have the most effect on accuracy and speed of the network
  let input = gui.addFolder('Input');
  // Architecture: there are a few PoseNet models varying in size and accuracy. 1.01
  // is the largest, but will be the slowest. 0.50 is the fastest, but least accurate.
  const architectureController =
    input.add(guiState.input, 'mobileNetArchitecture', ['1.01', '1.00', '0.75', '0.50']);
  // Output stride:  Internally, this parameter affects the height and width of the layers
  // in the neural network. The lower the value of the output stride the higher the accuracy
  // but slower the speed, the higher the value the faster the speed but lower the accuracy.
  input.add(guiState.input, 'outputStride', [8, 16, 32]);
  // Image scale factor: What to scale the image by before feeding it through the network.
  input.add(guiState.input, 'imageScaleFactor').min(0.2).max(1.0);
  input.open();

  // Pose confidence: the overall confidence in the estimation of a person's
  // pose (i.e. a person detected in a frame)
  // Min part confidence: the confidence that a particular estimated keypoint
  // position is accurate (i.e. the elbow's position)
  let single = gui.addFolder('Single Pose Detection');
  single.add(guiState.singlePoseDetection, 'minPoseConfidence', 0.0, 1.0);
  single.add(guiState.singlePoseDetection, 'minPartConfidence', 0.0, 1.0);
  single.open();

  let multi = gui.addFolder('Multi Pose Detection');
  multi.add(
    guiState.multiPoseDetection, 'maxPoseDetections').min(1).max(20).step(1);
  multi.add(guiState.multiPoseDetection, 'minPoseConfidence', 0.0, 1.0);
  multi.add(guiState.multiPoseDetection, 'minPartConfidence', 0.0, 1.0);
  // nms Radius: controls the minimum distance between poses that are returned
  // defaults to 20, which is probably fine for most use cases
  multi.add(guiState.multiPoseDetection, 'nmsRadius').min(0.0).max(40.0);

  let output = gui.addFolder('Output');
  output.add(guiState.output, 'showVideo');
  output.add(guiState.output, 'showSkeleton');
  output.add(guiState.output, 'showPoints');
  output.open();


  architectureController.onChange(function (architecture) {
    guiState.changeToArchitecture = architecture;
  });

  algorithmController.onChange(function (value) {
    switch (guiState.algorithm) {
      case 'single-pose':
        multi.close();
        single.open();
        break;
      case 'multi-pose':s
        single.close();
        multi.open();
        break;
    }
  });
}

/**
 * Sets up a frames per second panel on the top-left of the window
 */
function setupFPS() {
  stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
  document.body.appendChild(stats.dom);
}

/**
 * Feeds an image to posenet to estimate poses - this is where the magic happens.
 * This function loops with a requestAnimationFrame method.
 */
function detectPoseInRealTime(video, net) {
  const canvas = document.getElementById('output');
  const ctx = canvas.getContext('2d');
  const flipHorizontal = true; // since images are being fed from a webcam

  canvas.width = videoWidth;
  canvas.height = videoHeight;

  async function poseDetectionFrame() {
    if (guiState.changeToArchitecture) {
      // Important to purge variables and free up GPU memory
      guiState.net.dispose();

      // Load the PoseNet model weights for either the 0.50, 0.75, 1.00, or 1.01 version
      guiState.net = await posenet.load(Number(guiState.changeToArchitecture));

      guiState.changeToArchitecture = null;
    }

    // Begin monitoring code for frames per second
    stats.begin();

    // Scale an image down to a certain factor. Too large of an image will slow down
    // the GPU
    const imageScaleFactor = guiState.input.imageScaleFactor;
    const outputStride = Number(guiState.input.outputStride);

    let poses = [];
    let minPoseConfidence;
    let minPartConfidence;
    switch (guiState.algorithm) {
      case 'single-pose':
        const pose = await guiState.net.estimateSinglePose(video, imageScaleFactor, flipHorizontal, outputStride);
        poses.push(pose);

//////////////////////////////////// start work here ///////////////////////////////////////////////////////        
        
             
        
        myTemp =  await JSON.stringify(pose, null, 3)
        document.getElementById('myDiv01').value =   myTemp 

        let myLX = -1
        let myRX = -1       
        let myLY = -1
        let myRY = -1







        let mySendNew = 'A'
        let mySendOld = 'A'
        let mySpecialSend = false



        
        
        if (await JSON.stringify(pose.keypoints[13].score) > 0.5 ){
           myLX =   await JSON.stringify(pose.keypoints[13].position.x) 
           myLY =   await JSON.stringify(pose.keypoints[13].position.y) 
        } else {myLX = -1;  myLY = -1;}
        
        document.getElementById('myLeftKneeX').value =   myLX 
        document.getElementById('myLeftKneeY').value =   myLY
        
        if (await JSON.stringify(pose.keypoints[14].score) > 0.5 ){
           myRX =   await parseFloat(JSON.stringify(pose.keypoints[14].position.x)) 
           myRY =   await parseFloat(JSON.stringify(pose.keypoints[14].position.y)) 
        }  else {  myRX =  -1  ;  myRY = -1; }
        
        document.getElementById('myRightKneeX').value =   myRX
        document.getElementById('myRightKneeY').value =   myRY 
        
        
        
        //document.getElementById('myTotalSpeed').value = 0
        //document.getElementById('myDirectionToGo').value = 'Stay the course'
        // ws.send('P');

        let myAverageX = -1
        let myAverageY= -1
        let myShowSpot = 0

        // special variables for commands

        let myLS = -1  // left sholder y
        let myRW = -1  // Right Wrist y
        let myLW = -1  // Left Wrist y
        let mySholderError = 40
        let myWristAverage = 0

        if (await JSON.stringify(pose.keypoints[5].score) > 0.5 ){
           myLS =   await parseFloat(JSON.stringify(pose.keypoints[5].position.y)) 
        }  else {  myLS =  -1  ;  }


        if (await JSON.stringify(pose.keypoints[9].score) > 0.5 ){
           myLW =   await parseFloat(JSON.stringify(pose.keypoints[9].position.y)) 
        }  else {  myLW =  -1  ;  }

        if (await JSON.stringify(pose.keypoints[10].score) > 0.5 ){
           myRW =   await parseFloat(JSON.stringify(pose.keypoints[10].position.y)) 
        }  else {  myRW =  -1  ;  }







        //////   test left right wrist same height ar left sholder. 
        // Pass T command for reverse

        
       if (myLS > 0 && myRW > 0 && myLW > 0){


       // if ((myRW > (myLS - mySholderError) ) &&  ( myRW < (myLS + mySholderError)) && (myLW > (myLS - mySholderError))  &&  ( myLW < (myLS + mySholderError))) {

        myWristAverage = (myRW + myLW) / 2.0;


         if (myWristAverage > myLS - mySholderError &&  myWristAverage < myLS + mySholderError) {
          mySendNew = 'T'   // go backwards
          console.log('backwards')
         // console.log(myLS +', '+ myRW +', '+ myLW)
          mySpecialSend = true
        } else {
          mySpecialSend = false
          console.log('Off')
          mySendNew = 'Y'    // to stop
         // console.log(myLS +', '+ myWristAverage)
          }

       }





        // find average locations
      


      /*
        if ((myRY > 0 ) && (myLY > 0)){
          myAverageY=   ((parseInt(myRY) + parseInt(myLY)) / 2.0)   
        } 

            if ((myRX > 0 ) && (myLX > 0)){
          myAverageX =   ((parseInt(myRX) + parseInt(myLX)) / 2.0)   
        } 
*/


             // LETS NOT USE THE AVERAGE OF BOTH KNEES ANYOME
        if (myRY > 0 ){
          myAverageY =  myRY 
        } 

            if (myRX > 0 ) {
          myAverageX =   myRX 
        } 



         ////////////   version 2 starts 
         
         
         //let myGoodRX = 300
         //let myGoodLX = 100

         //let myGoodRY = 150
         //let myGoodLY = 250
         


         //let myMaxRight= 200
         //let myMaxLeft = 400

         //let myMaxTop = 250
        // let myMaxBottom = 300
         
         let myMaxRight= 150
         let myMaxLeft = 300

         let myMaxTop = 270
         let myMaxBottom = 300










         
         // sending these
         // p     q     r
         // s     t     u
         // v     w     x  


      if (mySpecialSend){   // only do calculations if not a special send

        if (mySendNew != mySendOld) {   
      
           ws.send(mySendNew);     // only sends 'T' backwards or 'Y' stop
         //  mySendOld = mySendNew
        
        }
      } else {
                 
        if (myAverageX < myMaxRight && myAverageX < myMaxLeft && myAverageY < myMaxTop && myAverageY < myMaxBottom) {  
            document.getElementById('myDirectionToGo').value = 'top Right: go right, slower '   + ' rx:' + Math.round(myRX) + ', ly:' + Math.round(myLY)
            myShowSpot -= 10; 
           // ws.send('p');
            mySendNew = 'p'
        } 
         
                 
        if (myAverageX > myMaxRight && myAverageX < myMaxLeft && myAverageY < myMaxTop && myAverageY < myMaxBottom) {   
            document.getElementById('myDirectionToGo').value = 'top Middle: go straight, slower '   + ' rx:' + Math.round(myRX) + ', ly:' + Math.round(myLY)
            myShowSpot -= 10; 
           // ws.send('q');
            mySendNew = 'q'
        } 
         

                  
        if (myAverageX > myMaxRight && myAverageX > myMaxLeft && myAverageY < myMaxTop && myAverageY < myMaxBottom) {  
            document.getElementById('myDirectionToGo').value = 'top Left: go Left, slower '   + ' rx:' + Math.round(myRX) + ', ly:' + Math.round(myLY)
            myShowSpot -= 10; 
           // ws.send('r');
            mySendNew = 'r'
        } 
         

///////////////////////////////////////////





        if (myAverageX < myMaxRight && myAverageX < myMaxLeft && myAverageY > myMaxTop && myAverageY < myMaxBottom) {   
          document.getElementById('myDirectionToGo').value = 'Right Middle: go right, set speed ' + ' rx:' + Math.round(myRX) + ', ly:' + Math.round(myLY)
          myShowSpot = 50; 
          //ws.send('s');
            mySendNew = 's'
        } 
               



        if (myAverageX > myMaxRight && myAverageX < myMaxLeft && myAverageY > myMaxTop && myAverageY < myMaxBottom) {  
          document.getElementById('myDirectionToGo').value = 'Middle: set turn, set speed ' + ' rx:' + Math.round(myRX) + ', ly:' + Math.round(myLY)
          myShowSpot = 50; 
          //ws.send('t');
            mySendNew = 't'
        } 
               

        if (myAverageX > myMaxRight && myAverageX > myMaxLeft && myAverageY > myMaxTop && myAverageY < myMaxBottom) {    
          document.getElementById('myDirectionToGo').value = 'Left Middle: go left, set speed ' + ' rx:' + Math.round(myRX) + ', ly:' + Math.round(myLY)
          myShowSpot = 50; 
          //ws.send('u');
            mySendNew = 'u'
        } 
               


///////////////////////////////////////////////////



                  
        if (myAverageX < myMaxRight && myAverageX < myMaxLeft && myAverageY > myMaxTop && myAverageY > myMaxBottom) {    
            document.getElementById('myDirectionToGo').value = 'bottom right: go right, faster '   + ' rx:' + Math.round(myRX) + ', ly:' + Math.round(myLY)
            myShowSpot += 10; 
            //ws.send('v');
            mySendNew = 'v'
        } 
        
                          
        if (myAverageX > myMaxRight && myAverageX < myMaxLeft && myAverageY > myMaxTop && myAverageY > myMaxBottom) {    
            document.getElementById('myDirectionToGo').value = 'bottom middle: go straight, faster ' + ' rx:' + Math.round(myRX) + ', ly:' + Math.round(myLY)
            myShowSpot += 10; 
            //ws.send('w');
            mySendNew = 'w'
        } 
        

                     
        if (myAverageX > myMaxRight && myAverageX > myMaxLeft && myAverageY > myMaxTop && myAverageY > myMaxBottom) {   
            document.getElementById('myDirectionToGo').value = 'bottom left: go left, faster ' + ' rx:' + Math.round(myRX) + ', ly:' + Math.round(myLY)
            myShowSpot += 10; 
            //ws.send('x');
            mySendNew = 'x'
        } 
        
///////////////////////////////////////////////////





         
         
        document.getElementById('myTotalSpeed').value = myShowSpot
         
     // if ((myRX == -1 ) || (myRY == -1) || (myLX == -1) || (myLY == -1) ){
      if (myRX == -1  || myRY == -1 ){
          // ws.send('Y');   // normal stop
        document.getElementById('myDirectionToGo').value = 'No Person, stop car ' + ' rx:' + Math.round(myRX) + ', ly:' + Math.round(myLY)
            mySendNew = 'Y'
       } 
          


    

       // only send info if the latest call is different


      if (mySendNew != mySendOld){
         ws.send(mySendNew); 
      } else {
        if (mySendNew == 'Y' || mySendNew == 'Z'  ){
          // don't send again
        } else {
          ws.send(mySendNew); // send just to make sure it was sent for turning etc
        }
      }






      //  if (mySendNew != mySendOld) {        
       //    ws.send(mySendNew); 
      //     mySendOld = mySendNew
     //   }





    }    // end big loop containing mySpecial

      mySendOld = mySendNew
         
         // sending these
         // p     q     r
         // s     t     u
         // v     w     x  


        // check for values that only need to be sent once
/*

        if (mySendNew == 'Y' || mySendNew == 'Z'  || mySendNew == 't'  ) {
        if (mySendNew != mySendOld) {
          mySendOld = mySendNew
          ws.send(mySendNew);   // send the info only if it is different than the old info
        }
      }   // end sending minimal times
         
          // else always send that data
      else {
          ws.send(mySendNew); 
          mySendOld = mySendNew
      }



*/





        /////////////// version 2 ends  

//////////////////////////////////// stop work here ///////////////////////////////////////////////////////                
        
        minPoseConfidence = Number(
          guiState.singlePoseDetection.minPoseConfidence);
        minPartConfidence = Number(
          guiState.singlePoseDetection.minPartConfidence);
        break;
      case 'multi-pose':
        poses = await guiState.net.estimateMultiplePoses(video, imageScaleFactor, flipHorizontal, outputStride,
          guiState.multiPoseDetection.maxPoseDetections,
          guiState.multiPoseDetection.minPartConfidence,
          guiState.multiPoseDetection.nmsRadius);

        minPoseConfidence = Number(guiState.multiPoseDetection.minPoseConfidence);
        minPartConfidence = Number(guiState.multiPoseDetection.minPartConfidence);
        break;
    }

    ctx.clearRect(0, 0, videoWidth, videoHeight);

    if (guiState.output.showVideo) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.translate(-videoWidth, 0);
      ctx.drawImage(video, 0, 0, videoWidth, videoHeight);
      ctx.restore();
    }

    // For each pose (i.e. person) detected in an image, loop through the poses
    // and draw the resulting skeleton and keypoints if over certain confidence
    // scores
    poses.forEach(({ score, keypoints }) => {
      if (score >= minPoseConfidence) {
        if (guiState.output.showPoints) {
          drawKeypoints(keypoints, minPartConfidence, ctx);
        }
        if (guiState.output.showSkeleton) {
          drawSkeleton(keypoints, minPartConfidence, ctx);
        }
      }
    });

    // End monitoring code for frames per second
    stats.end();

    requestAnimationFrame(poseDetectionFrame);
  }

  poseDetectionFrame();
}

/**
 * Kicks off the demo by loading the posenet model, finding and loading available
 * camera devices, and setting off the detectPoseInRealTime function.
 */
 async function bindPage() {
   
  document.getElementById('myVersionDiv').innerHTML = 'This version of Tensorflowjs = ' + tf.version.tfjs  
   
   
  // Load the PoseNet model weights for version 1.01
  const net = await posenet.load();

  document.getElementById('loading').style.display = 'none';
  document.getElementById('main').style.display = 'block';

  let video;

  try {
    video = await loadVideo();
  } catch(e) {
    let info = document.getElementById('info');
    info.textContent = "this browser does not support video capture, or this device does not have a camera";
    info.style.display = 'block';
    throw e;
  }

  setupGui([], net);
  setupFPS();
  detectPoseInRealTime(video, net);
}

navigator.getUserMedia = navigator.getUserMedia ||
  navigator.webkitGetUserMedia ||
  navigator.mozGetUserMedia;
bindPage(); // kick off the demo
