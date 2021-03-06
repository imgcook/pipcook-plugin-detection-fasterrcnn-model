import { ModelDefineType, UniModel, ModelDefineArgsType, ImageSample, CocoDataset, download, constants } from '@pipcook/pipcook-core';
import * as path from 'path';
import * as fs from 'fs-extra';

const boa = require('@pipcook/boa');

const MODEL_WEIGHTS_NAME = 'R-50.pkl';
const MODEL_URL =
  `http://ai-sample.oss-cn-hangzhou.aliyuncs.com/pipcook/models/detectron_r50/${MODEL_WEIGHTS_NAME}`;
const MODEL_PATH = path.join(
  constants.TORCH_DIR,
  'fvcore_cache',
  'detectron2',
  'ImageNetPretrained',
  'MSRA',
  MODEL_WEIGHTS_NAME
);

const detectronModelDefine: ModelDefineType = async (data: CocoDataset, args: ModelDefineArgsType): Promise<UniModel> => {
  let {
    baseLearningRate = 0.00025,
    numWorkers = 0,
    numGpus = 2,
    batchSize = 32,
    numClasses = 0,
    recoverPath
  } = args;

  let cfg: any;
  let log: any;

  if (recoverPath) {
    log = await fs.readJSON(path.join(recoverPath, '..', 'metadata.json'))
    const labelMap = JSON.parse(log.output.dataset).labelMap;
    numClasses = Object.keys(labelMap).length;
  } else {
    numClasses = Object.keys(data.metadata.labelMap).length;
  }

  const { get_cfg } = boa.import('detectron2.config');
  const { setup_logger } = boa.import('detectron2.utils.logger');
  const torch = boa.import('torch');
  const { DefaultPredictor } = boa.import('detectron2.engine.defaults');
  const cv2 = boa.import('cv2');

  setup_logger();

  cfg = get_cfg();
  cfg.merge_from_file(path.join(__dirname, 'config', 'faster_rcnn_R_50_C4_3x.yaml'));
  cfg.DATALOADER.NUM_WORKERS = numWorkers;

  if (!await fs.pathExists(MODEL_PATH)) {
    await download(MODEL_URL, MODEL_PATH);
  }

  if (recoverPath) {
    cfg.MODEL.WEIGHTS = path.join(recoverPath, 'model_final.pth');
  } else {
    cfg.MODEL.WEIGHTS = MODEL_PATH;
  }

  cfg.SOLVER.IMS_PER_BATCH = 4;
  cfg.SOLVER.BASE_LR = baseLearningRate;
  cfg.SOLVER.NUM_GPUS = numGpus;

  if (!torch.cuda.is_available()) {
    cfg.MODEL.DEVICE = 'cpu';
  }

  cfg.MODEL.ROI_HEADS.BATCH_SIZE_PER_IMAGE = batchSize;
  cfg.MODEL.ROI_HEADS.NUM_CLASSES = numClasses;

  const pipcookModel: UniModel = {
    model: null,
    config: cfg,
    predict: function (inputData: ImageSample) {
      const predictor = DefaultPredictor(this.config);
      const img = cv2.imread(inputData.data);
      const out = predictor(img);
      const ins = out['instances'].to(torch.device('cpu'));    
      const scores = Array.from(ins.scores.numpy().tolist());
      const classes = Array.from(ins.pred_classes.numpy().tolist());
      let boxes = Array.from(ins.pred_boxes.tensor.numpy().tolist());
      boxes = boxes.map((box: any) => Array.from(box));
      const labels = classes.map((ele: number) => JSON.parse(log.output.dataset).labelArray[ele]);
      return {
        boxes,
        scores,
        classes,
        labels
      };
    }
  };
  return pipcookModel;
};

export default detectronModelDefine;
